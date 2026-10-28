import React, { useState } from 'react'
import { ArchiveRestore, ChevronRight, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
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
import { useClaudeSessionNumbers } from './claude-session-numbers-store'
import { deletePastChat, setChatInactive } from './past-chats-store'

const VISIBLE = 3

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

export async function resumePastChat(
  session: AiVaultSession,
  worktreeId: string | null
): Promise<void> {
  const target = worktreeId ?? useAppStore.getState().activeWorktreeId
  if (!target) {
    toast.message('Open a project first', {
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

const stop = (e: React.SyntheticEvent): void => e.stopPropagation()

const PastChatRow = React.memo(function PastChatRow({
  session,
  worktreeId,
  inactive
}: {
  session: AiVaultSession
  worktreeId: string | null
  inactive: boolean
}): React.JSX.Element {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const numbers = useClaudeSessionNumbers(session.agent === 'claude' ? session.filePath : undefined)
  const cost = formatSessionCost(numbers?.costUsd ?? null)
  const meta = [
    ago(session.updatedAt ?? session.modifiedAt),
    cost ? `≈${cost}` : null,
    numbers ? formatSessionWorkingTime(numbers.workingMs) : null
  ].filter(Boolean)
  const onDelete = async (): Promise<void> => {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setTimeout(() => setConfirmDelete(false), 4000)
      return
    }
    const error = await deletePastChat(session)
    if (error) {
      toast.error('Could not delete this chat', { description: error })
    } else {
      toast.success(`Deleted "${session.title || 'chat'}" (moved to the Recycle Bin)`)
    }
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => {
        stop(e)
        void resumePastChat(session, worktreeId)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          stop(e)
          void resumePastChat(session, worktreeId)
        }
      }}
      onMouseDown={stop}
      title={`${session.title}\n${session.cwd ?? ''}\nClick to resume`}
      className={cn(
        'group/past-chat flex min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-worktree-sidebar-accent',
        inactive && 'opacity-60'
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] text-foreground/90">
          {session.title || 'Untitled chat'}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground tabular-nums">
          {meta.join(' · ')}
        </span>
      </span>
      <button
        type="button"
        title={inactive ? 'Restore to the chat list' : 'Close: move to Inactive (the chat is kept)'}
        aria-label={inactive ? 'Restore chat' : 'Close chat'}
        onClick={(e) => {
          stop(e)
          setChatInactive(session.id, !inactive)
        }}
        className="hidden rounded-sm p-0.5 text-muted-foreground hover:bg-worktree-sidebar-accent hover:text-foreground group-hover/past-chat:inline-flex"
      >
        {inactive ? <ArchiveRestore className="size-3" /> : <X className="size-3" />}
      </button>
      <button
        type="button"
        title={
          confirmDelete ? 'Click again to delete' : 'Delete chat (moves it to the Recycle Bin)'
        }
        aria-label="Delete chat"
        onClick={(e) => {
          stop(e)
          void onDelete()
        }}
        className={cn(
          'rounded-sm p-0.5 hover:bg-destructive/10 hover:text-destructive',
          confirmDelete
            ? 'inline-flex text-destructive'
            : 'hidden text-muted-foreground group-hover/past-chat:inline-flex'
        )}
      >
        {confirmDelete ? (
          <span className="px-0.5 text-[10px] font-medium">Delete?</span>
        ) : (
          <Trash2 className="size-3" />
        )}
      </button>
    </div>
  )
})

/** Chats of one place: newest few, "show more", and a collapsed Inactive list for closed chats. */
export function PastChatRows({
  sessions,
  worktreeId,
  inactiveIds
}: {
  sessions: readonly AiVaultSession[]
  worktreeId: string | null
  inactiveIds: ReadonlySet<string>
}): React.JSX.Element | null {
  const [showAll, setShowAll] = useState(false)
  const [showInactive, setShowInactive] = useState(false)
  const active = sessions.filter((s) => !inactiveIds.has(s.id))
  const inactive = sessions.filter((s) => inactiveIds.has(s.id))
  if (!sessions.length) {
    return null
  }
  const shown = showAll ? active : active.slice(0, VISIBLE)
  const toggleClass =
    'flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground'
  return (
    <div onMouseDown={stop} onClick={stop}>
      {shown.map((s) => (
        <PastChatRow key={s.id} session={s} worktreeId={worktreeId} inactive={false} />
      ))}
      {active.length > VISIBLE ? (
        <button type="button" className={toggleClass} onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show ${active.length - VISIBLE} more`}
        </button>
      ) : null}
      {inactive.length ? (
        <>
          <button
            type="button"
            className={toggleClass}
            onClick={() => setShowInactive(!showInactive)}
          >
            <ChevronRight
              className={cn('size-3 transition-transform', showInactive && 'rotate-90')}
            />
            Inactive ({inactive.length})
          </button>
          {showInactive
            ? inactive.map((s) => (
                <PastChatRow key={s.id} session={s} worktreeId={worktreeId} inactive />
              ))
            : null}
        </>
      ) : null}
    </div>
  )
}
