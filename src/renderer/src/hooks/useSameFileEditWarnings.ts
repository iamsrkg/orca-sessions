import { useEffect } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import type { AgentStatusEntry } from '../../../shared/agent-status-types'

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Create'])
const WINDOW_MS = 10 * 60_000

type FileEdit = { paneKey: string; at: number; label: string }

function fileKey(path: string): string {
  const slashed = path.trim().replace(/\\/g, '/')
  return navigator.userAgent.includes('Windows') ? slashed.toLowerCase() : slashed
}

function agentLabel(entry: AgentStatusEntry): string {
  const text = entry.terminalTitle?.trim() || entry.prompt?.trim() || 'An agent'
  return text.length > 48 ? `${text.slice(0, 47)}…` : text
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** Warns when two agents edit the same file within 10 minutes, before one silently overwrites the other's work. */
export function useSameFileEditWarnings(): void {
  useEffect(() => {
    const editsByFile = new Map<string, FileEdit[]>()
    const warned = new Map<string, number>()
    return useAppStore.subscribe((state, previous) => {
      if (state.agentStatusByPaneKey === previous.agentStatusByPaneKey) {
        return
      }
      const now = Date.now()
      for (const [paneKey, entry] of Object.entries(state.agentStatusByPaneKey)) {
        const before = previous.agentStatusByPaneKey[paneKey]
        const path = entry.toolInput?.trim()
        if (
          !path ||
          !entry.toolName ||
          !EDIT_TOOLS.has(entry.toolName) ||
          (before?.toolName === entry.toolName && before?.toolInput === entry.toolInput)
        ) {
          continue
        }
        const key = fileKey(path)
        const recent = (editsByFile.get(key) ?? []).filter((e) => now - e.at <= WINDOW_MS)
        const other = recent.find((e) => e.paneKey !== paneKey)
        const label = agentLabel(entry)
        editsByFile.set(key, [
          ...recent.filter((e) => e.paneKey !== paneKey),
          { paneKey, at: now, label }
        ])
        if (!other) {
          continue
        }
        const pairKey = `${key}|${[other.paneKey, paneKey].sort().join('|')}`
        if (now - (warned.get(pairKey) ?? 0) <= WINDOW_MS) {
          continue
        }
        warned.set(pairKey, now)
        const title = `Two agents edited ${fileName(path)}`
        const body = `"${other.label}" and "${label}" both changed ${path} in the last 10 minutes. Their edits may overwrite each other.`
        toast.warning(title, { description: body, duration: 20_000 })
        if (!document.hasFocus() && 'Notification' in window) {
          try {
            new Notification(title, { body })
          } catch {
            // The in-app warning above still shows.
          }
        }
      }
    })
  }, [])
}
