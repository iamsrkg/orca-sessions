import { useEffect, useSyncExternalStore } from 'react'
import type { ClaudeSessionNumbers } from '../../../../shared/claude-session-numbers'

const POLL_MS = 15_000
const numbersByPath = new Map<string, ClaudeSessionNumbers>()
const subscriberCounts = new Map<string, number>()
const listeners = new Set<() => void>()
let pollTimer: ReturnType<typeof setInterval> | null = null
let inFlight = false

async function refresh(): Promise<void> {
  if (inFlight || subscriberCounts.size === 0 || document.hidden) {
    return
  }
  inFlight = true
  try {
    const result = await window.api.claudeSessionNumbers.get([...subscriberCounts.keys()])
    let changed = false
    for (const [path, numbers] of Object.entries(result)) {
      const previous = numbersByPath.get(path)
      if (
        !previous ||
        previous.contextTokens !== numbers.contextTokens ||
        previous.costUsd !== numbers.costUsd ||
        previous.workingMs !== numbers.workingMs
      ) {
        numbersByPath.set(path, numbers)
        changed = true
      }
    }
    if (changed) {
      for (const listener of listeners) {
        listener()
      }
    }
  } catch {
    // Older hosts lack the channel; rows simply show no numbers.
  } finally {
    inFlight = false
  }
}

function track(path: string): () => void {
  subscriberCounts.set(path, (subscriberCounts.get(path) ?? 0) + 1)
  pollTimer ??= setInterval(() => void refresh(), POLL_MS)
  void refresh()
  return () => {
    const count = (subscriberCounts.get(path) ?? 1) - 1
    if (count > 0) {
      subscriberCounts.set(path, count)
      return
    }
    subscriberCounts.delete(path)
    if (subscriberCounts.size === 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Context fill, estimated cost and working time of one Claude transcript, refreshed every 15 s while visible. */
export function useClaudeSessionNumbers(
  transcriptPath: string | undefined,
  refreshKey?: string
): ClaudeSessionNumbers | null {
  useEffect(() => (transcriptPath ? track(transcriptPath) : undefined), [transcriptPath])
  // A state change (turn finished) is the moment new numbers exist; refresh then instead of waiting.
  useEffect(() => {
    if (transcriptPath && refreshKey) {
      void refresh()
    }
  }, [transcriptPath, refreshKey])
  return useSyncExternalStore(subscribe, () =>
    transcriptPath ? (numbersByPath.get(transcriptPath) ?? null) : null
  )
}
