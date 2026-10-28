import React, { useMemo, useState } from 'react'
import { ChevronRight, FolderPlus, History, RefreshCw } from 'lucide-react'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { AddHistoryProjectsDialog } from './AddHistoryProjectsDialog'
import { normalizePath } from './past-chat-groups'
import { reloadPastChats, usePastChats } from './past-chats-store'
import { PastChatRows } from './PastChatRows'
import { usePastChatAssignment } from './use-past-chat-assignment'

const OPEN_KEY = 'orca-sessions.otherChats.open'

function folderLabel(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/') || path
}

/** Left panel bottom: chats outside every project, grouped by folder. Project chats show under their workspace. */
export function PastChatsSection(): React.JSX.Element | null {
  const repos = useAppStore((s) => s.repos)
  const { sessions } = usePastChats()
  const view = usePastChatAssignment()
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== '0')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const groups = useMemo(() => {
    const map = new Map<string, { label: string; folder: string; sessions: AiVaultSession[] }>()
    for (const session of view.others) {
      const folder = session.cwd ?? 'Unknown folder'
      const key = normalizePath(folder)
      const group = map.get(key) ?? { label: folderLabel(folder), folder, sessions: [] }
      group.sessions.push(session)
      map.set(key, group)
    }
    return [...map.entries()]
  }, [view.others])
  const cwds = useMemo(
    () => [...new Set((sessions ?? []).map((s) => s.cwd).filter((c): c is string => Boolean(c)))],
    [sessions]
  )
  const knownPaths = useMemo(() => new Set(repos.map((r) => normalizePath(r.path))), [repos])

  const refresh = async (): Promise<void> => {
    setLoading(true)
    await reloadPastChats(true)
    setLoading(false)
  }
  const toggleOpen = (): void => {
    setOpen(!open)
    localStorage.setItem(OPEN_KEY, open ? '0' : '1')
  }
  const toggleGroup = (key: string): void => {
    const next = new Set(expanded)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    setExpanded(next)
  }

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col border-t border-worktree-sidebar-border',
        open && 'max-h-[40%]'
      )}
    >
      <div className="flex h-8 shrink-0 items-center gap-1 px-2">
        <button
          type="button"
          onClick={toggleOpen}
          title="Chats from folders that are not projects (project chats show under their workspace)"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-[12px] font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
          <History className="size-3.5" />
          Other chats
          <span className="text-2xs tabular-nums">{view.loaded ? view.others.length : ''}</span>
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
          title="Refresh chats"
          aria-label="Refresh chats"
          onClick={() => void refresh()}
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
          {!view.loaded ? (
            <p className="px-2 py-1 text-2xs text-muted-foreground">Reading your chat history…</p>
          ) : groups.length === 0 ? (
            <p className="px-2 py-1 text-2xs text-muted-foreground">
              Every chat belongs to a project.
            </p>
          ) : (
            groups.map(([key, group]) => (
              <div key={key}>
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  title={group.folder}
                  className="flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-[12px] text-muted-foreground hover:bg-worktree-sidebar-accent"
                >
                  <ChevronRight
                    className={cn(
                      'size-3.5 shrink-0 transition-transform',
                      expanded.has(key) && 'rotate-90'
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  <span className="text-2xs tabular-nums">{group.sessions.length}</span>
                </button>
                {expanded.has(key) ? (
                  <div className="pl-4">
                    <PastChatRows
                      sessions={group.sessions}
                      worktreeId={null}
                      inactiveIds={view.inactive}
                    />
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : null}
      <AddHistoryProjectsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        cwds={cwds}
        knownPaths={knownPaths}
        onAdded={() => void reloadPastChats()}
      />
    </div>
  )
}
