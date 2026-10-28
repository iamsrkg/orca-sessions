import { useSyncExternalStore } from 'react'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'

// One shared copy of the saved-chat list for every workspace card and the "Other chats" section.
const INACTIVE_KEY = 'orca-sessions.inactiveChats'
const REFRESH_MS = 60_000

type Snapshot = {
  sessions: AiVaultSession[] | null
  inactive: ReadonlySet<string>
  version: number
}

let snapshot: Snapshot = { sessions: null, inactive: readInactive(), version: 0 }
const listeners = new Set<() => void>()
let started = false
let loading: Promise<void> | null = null

function readInactive(): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(INACTIVE_KEY) ?? '[]')
    return new Set(Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function publish(next: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...next, version: snapshot.version + 1 }
  for (const listener of listeners) {
    listener()
  }
}

export function reloadPastChats(force = false): Promise<void> {
  loading ??= window.api.aiVault
    .listSessions({ limit: 500, force })
    .then((result) => {
      if (!result.cancelled) {
        publish({ sessions: result.sessions.filter((s) => !s.structuredSession) })
      }
    })
    .catch(() => {
      // Keep the last list; the next focus or timer retries.
    })
    .finally(() => {
      loading = null
    })
  return loading
}

function start(): void {
  if (started) {
    return
  }
  started = true
  void reloadPastChats()
  window.api.aiVault.onWindowFocused(() => void reloadPastChats())
  setInterval(() => {
    if (!document.hidden) {
      void reloadPastChats()
    }
  }, REFRESH_MS)
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function usePastChats(): Snapshot {
  return useSyncExternalStore(subscribe, () => snapshot)
}

/** Close = keep the chat but move it to the "Inactive" list; restore brings it back. */
export function setChatInactive(sessionKey: string, inactive: boolean): void {
  const next = new Set(snapshot.inactive)
  if (inactive) {
    next.add(sessionKey)
  } else {
    next.delete(sessionKey)
  }
  try {
    localStorage.setItem(INACTIVE_KEY, JSON.stringify([...next]))
  } catch {
    // Storage off: the choice lasts until the window reloads.
  }
  publish({ inactive: next })
}

/** Moves the chat's transcript to the Recycle Bin (Orca's own delete), then refreshes the list. */
export async function deletePastChat(session: AiVaultSession): Promise<string | null> {
  const result = await window.api.aiVault.deleteSession({
    agent: session.agent,
    sessionId: session.sessionId,
    filePath: session.filePath,
    executionHostId: session.executionHostId
  })
  if (result.outcome === 'failed') {
    return result.error
  }
  if (result.outcome === 'rejected') {
    return `Orca refused to delete this chat (${result.reason})`
  }
  setChatInactive(session.id, false)
  await reloadPastChats(true)
  return null
}
