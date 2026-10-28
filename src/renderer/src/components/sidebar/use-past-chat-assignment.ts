import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { assignPastChatsToWorktrees, type PastChatAssignment } from './past-chat-groups'
import { usePastChats } from './past-chats-store'

export type PastChatView = PastChatAssignment & { inactive: ReadonlySet<string>; loaded: boolean }

/** Saved chats assigned to workspaces, minus chats that are running in Orca right now (those show as agent rows). */
export function usePastChatAssignment(): PastChatView {
  const { sessions, inactive } = usePastChats()
  const repos = useAppStore((s) => s.repos)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const liveIds = useAppStore((s) => {
    const ids: string[] = []
    for (const entry of Object.values(s.agentStatusByPaneKey)) {
      if (entry.providerSession?.id) {
        ids.push(entry.providerSession.id)
      }
    }
    return ids.sort().join('|')
  })
  return useMemo(() => {
    const live = new Set(liveIds ? liveIds.split('|') : [])
    const past = (sessions ?? []).filter((s: AiVaultSession) => !live.has(s.sessionId))
    return {
      ...assignPastChatsToWorktrees(past, repos, worktreesByRepo),
      inactive,
      loaded: sessions !== null
    }
  }, [sessions, inactive, repos, worktreesByRepo, liveIds])
}
