import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, FolderPlus, History, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { buildAiVaultResumeStartupForWorktree } from '@/lib/ai-vault-resume-command'
import { launchAiVaultSessionAndReveal } from '@/lib/launch-ai-vault-session-and-reveal'
import {
  dropDeletedRemoteResumeCwd,
  prepareAiVaultSessionForTerminalResume
} from '@/lib/ai-vault-session-resume-preparation'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import {
  formatSessionCost,
  formatSessionWorkingTime
} from '../../../../shared/claude-session-numbers'
import { AddHistoryProjectsDialog } from './AddHistoryProjectsDialog'
import { useClaudeSessionNumbers } from './claude-session-numbers-store'
import { groupPastChats, normalizePath, type PastChatGroup } from './past-chat-groups'

const STORE_KEY = 'orca-sessions.pastChats.expanded'
const readExpanded = (): string[] => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []
  } catch {
    return []
  }
}

function ago(iso: string | null): string {
  const time = iso ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(time)) {
    return ''
  }
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 60) {
    return `${Math.max(1, minutes)}m ago`
  }
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}

async function resumePastChat(session: AiVaultSession, worktreeId: string | null): Promise<void> {
  const target = worktreeId ?? useAppStore.getState().activeWorktreeId
  if (!target) {
    toast.message('Add or open a project first', {
      description: 'A chat resumes inside a workspace; it still runs in its own folder.'
    })
    return
  }
  try {
    const prepared = await dropDeletedRemoteResumeCwd(
      await prepareAiVaultSessionForTerminalResume(session)
    )
    const startup = buildAiVaultResumeStartupForWorktree({
      state: useAppStore.getState(),
      worktreeId: target,
      session: prepared
    })
    await launchAiVaultSessionAndReveal(
      { agent: session.agent, worktreeId: target, ...startup },
      (m) => m
    )
  } catch (error) {
    toast.error('Could not resume this chat', {
      description: error instanceof Error ? error.message : String(error)
    })
  }
}

const PastChatRow = React.memo(function PastChatRow({
  session,
  worktreeId
}: {
  session: AiVaultSession
  worktreeId: string | null
}): React.JSX.Element {
  const numbers = useClaudeSessionNumbers(session.agent === 'claude' ? session.filePath : undefined)
  const cost = formatSessionCost(numbers?.costUsd ?? null)
  const meta = [
    ago(session.updatedAt ?? session.modifiedAt),
    cost ? `≈${cost}` : null,
    numbers ? formatSessionWorkingTime(numbers.workingMs) : null,
    session.branch && !/^(main|master)$/.test(session.branch) ? session.branch : null
  ].filter(Boolean)
  return (
    <button
      type="button"
      onClick={() => void resumePastChat(session, worktreeId)}
      title={`${session.title}\n${session.cwd ?? ''}\nClick to resume`}
      className="block w-full rounded-sm px-2 py-1 text-left hover:bg-worktree-sidebar-accent"
    >
      <span className="block truncate text-[12px] text-foreground">
        {session.title || 'Untitled chat'}
      </span>
      <span className="block truncate text-[10px] text-muted-foreground tabular-nums">
        {meta.join(' · ')}
      </span>
    </button>
  )
})

function GroupBlock({
  group,
  expanded,
  onToggle
}: {
  group: PastChatGroup
  expanded: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-[12px] hover:bg-worktree-sidebar-accent"
        title={group.folder ?? undefined}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-90'
          )}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            group.isProject ? 'font-medium text-foreground' : 'text-muted-foreground'
          )}
        >
          {group.label}
        </span>
        <span className="text-2xs text-muted-foreground tabular-nums">{group.sessions.length}</span>
      </button>
      {expanded ? (
        <div className="pl-4">
          {group.sessions.map((session) => (
            <PastChatRow key={session.id} session={session} worktreeId={group.worktreeId} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Left panel: every past chat grouped by project (like Claude Sessions' History), click to resume. */
export function PastChatsSection(): React.JSX.Element | null {
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const [sessions, setSessions] = useState<AiVaultSession[] | null>(null)
  const [open, setOpen] = useState(() => localStorage.getItem(`${STORE_KEY}.open`) !== '0')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(readExpanded()))
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    try {
      const result = await window.api.aiVault.listSessions({ limit: 500, force })
      if (!result.cancelled) {
        setSessions(result.sessions.filter((s) => !s.structuredSession))
      }
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load(false)
    return window.api.aiVault.onWindowFocused(() => void load(false))
  }, [load])

  const groups = useMemo(
    () => (sessions ? groupPastChats(sessions, repos, worktreesByRepo) : []),
    [sessions, repos, worktreesByRepo]
  )
  const cwds = useMemo(
    () => [...new Set((sessions ?? []).map((s) => s.cwd).filter((c): c is string => Boolean(c)))],
    [sessions]
  )
  const knownPaths = useMemo(() => new Set(repos.map((r) => normalizePath(r.path))), [repos])

  const toggleOpen = (): void => {
    setOpen(!open)
    localStorage.setItem(`${STORE_KEY}.open`, open ? '0' : '1')
  }
  const toggleGroup = (key: string): void => {
    const next = new Set(expanded)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setExpanded(next)
    localStorage.setItem(STORE_KEY, JSON.stringify([...next]))
  }

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col border-t border-worktree-sidebar-border',
        open && 'max-h-[45%] min-h-24'
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 px-2">
        <button
          type="button"
          onClick={toggleOpen}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          <History className="size-3.5" />
          Past chats
          <span className="text-2xs tabular-nums">{sessions ? sessions.length : ''}</span>
        </button>
        <button
          type="button"
          title="Add projects from my chat history"
          aria-label="Add projects from my chat history"
          onClick={() => setDialogOpen(true)}
          className="rounded-sm p-1 text-muted-foreground hover:bg-worktree-sidebar-accent hover:text-foreground"
        >
          <FolderPlus className="size-3.5" />
        </button>
        <button
          type="button"
          title="Refresh past chats"
          aria-label="Refresh past chats"
          onClick={() => void load(true)}
          disabled={loading}
          className="rounded-sm p-1 text-muted-foreground hover:bg-worktree-sidebar-accent hover:text-foreground"
        >
          <RefreshCw
            className={cn('size-3.5', loading && 'animate-spin motion-reduce:animate-none')}
          />
        </button>
      </div>
      {open ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2 scrollbar-sleek">
          {!sessions ? (
            <p className="px-2 py-1 text-2xs text-muted-foreground">Reading your chat history…</p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-1 text-2xs text-muted-foreground">No past chats found.</p>
          ) : (
            groups.map((group) => (
              <GroupBlock
                key={group.key}
                group={group}
                expanded={expanded.has(group.key)}
                onToggle={() => toggleGroup(group.key)}
              />
            ))
          )}
        </div>
      ) : null}
      <AddHistoryProjectsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cwds={cwds}
        knownPaths={knownPaths}
        onAdded={() => void load(false)}
      />
    </div>
  )
}
