import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'

export type PastChatGroup = {
  key: string
  label: string
  /** Workspace a chat of this group resumes in; null for chats outside every project. */
  worktreeId: string | null
  /** Folder the group stands for (project root, or the chat folder for "other" groups). */
  folder: string | null
  isProject: boolean
  sessions: AiVaultSession[]
}

const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows')

export function normalizePath(path: string): string {
  const slashed = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return isWindows ? slashed.toLowerCase() : slashed
}

const inside = (child: string, parent: string): boolean =>
  child === parent || child.startsWith(`${parent}/`)

function folderLabel(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-2).join('/') || path
}

/** Past chats grouped by the project whose folder (or worktree folder) they ran in; the rest by folder. */
export function groupPastChats(
  sessions: readonly AiVaultSession[],
  repos: readonly Repo[],
  worktreesByRepo: Readonly<Record<string, readonly Worktree[] | undefined>>
): PastChatGroup[] {
  const roots: { repo: Repo; worktree: Worktree | null; path: string }[] = []
  for (const repo of repos) {
    const worktrees = (worktreesByRepo[repo.id] ?? []).filter((w) => !w.isArchived)
    for (const worktree of worktrees) {
      roots.push({ repo, worktree, path: normalizePath(worktree.path) })
    }
    roots.push({ repo, worktree: worktrees[0] ?? null, path: normalizePath(repo.path) })
  }
  // Longest path first, so a chat in a worktree folder joins that worktree, not its parent.
  roots.sort((a, b) => b.path.length - a.path.length)
  const groups = new Map<string, PastChatGroup>()
  for (const session of sessions) {
    if (!session.cwd) {
      continue
    }
    const cwd = normalizePath(session.cwd)
    const match = roots.find((r) => inside(cwd, r.path))
    const key = match ? `repo:${match.repo.id}` : `dir:${cwd}`
    const group = groups.get(key) ?? {
      key,
      label: match ? match.repo.displayName : folderLabel(session.cwd),
      worktreeId: match?.worktree?.id ?? null,
      folder: match ? match.repo.path : session.cwd,
      isProject: Boolean(match),
      sessions: []
    }
    group.sessions.push(session)
    groups.set(key, group)
  }
  const recency = (s: AiVaultSession): number => Date.parse(s.updatedAt ?? s.modifiedAt) || 0
  const list = [...groups.values()]
  for (const group of list) {
    group.sessions.sort((a, b) => recency(b) - recency(a))
  }
  // Projects first, then other folders; each by its newest chat.
  return list.sort(
    (a, b) =>
      Number(b.isProject) - Number(a.isProject) || recency(b.sessions[0]) - recency(a.sessions[0])
  )
}

export type PastChatAssignment = {
  byWorktree: Map<string, AiVaultSession[]>
  /** Chats outside every project folder. */
  others: AiVaultSession[]
}

/** Each chat goes to the workspace whose folder holds it (deepest match); a repo-root chat goes to its first workspace. */
export function assignPastChatsToWorktrees(
  sessions: readonly AiVaultSession[],
  repos: readonly Repo[],
  worktreesByRepo: Readonly<Record<string, readonly Worktree[] | undefined>>
): PastChatAssignment {
  const roots: { worktreeId: string; path: string }[] = []
  for (const repo of repos) {
    const worktrees = (worktreesByRepo[repo.id] ?? []).filter((w) => !w.isArchived)
    for (const worktree of worktrees) {
      roots.push({ worktreeId: worktree.id, path: normalizePath(worktree.path) })
    }
    if (worktrees[0]) {
      roots.push({ worktreeId: worktrees[0].id, path: normalizePath(repo.path) })
    }
  }
  roots.sort((a, b) => b.path.length - a.path.length)
  const byWorktree = new Map<string, AiVaultSession[]>()
  const others: AiVaultSession[] = []
  const recency = (s: AiVaultSession): number => Date.parse(s.updatedAt ?? s.modifiedAt) || 0
  for (const session of [...sessions].sort((a, b) => recency(b) - recency(a))) {
    const cwd = session.cwd ? normalizePath(session.cwd) : null
    const match = cwd ? roots.find((r) => inside(cwd, r.path)) : undefined
    if (!match) {
      others.push(session)
      continue
    }
    const list = byWorktree.get(match.worktreeId) ?? []
    list.push(session)
    byWorktree.set(match.worktreeId, list)
  }
  return { byWorktree, others }
}
