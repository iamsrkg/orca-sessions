import React from 'react'
import { History } from 'lucide-react'
import { PastChatRows } from './PastChatRows'
import { usePastChatAssignment } from './use-past-chat-assignment'

/** Saved chats that ran in this workspace's folder, shown under its card; click to resume. */
export function WorktreeCardPastChats({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const view = usePastChatAssignment()
  const sessions = view.byWorktree.get(worktreeId)
  if (!sessions?.length) {
    return null
  }
  const activeCount = sessions.filter((s) => !view.inactive.has(s.id)).length
  return (
    <div className="mt-1 border-t border-worktree-sidebar-border/60 pt-1">
      <div className="flex items-center gap-1 px-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <History className="size-3" />
        Chats <span className="tabular-nums">{activeCount}</span>
      </div>
      <PastChatRows sessions={sessions} worktreeId={worktreeId} inactiveIds={view.inactive} />
    </div>
  )
}
