import { ipcMain } from 'electron'
import type { ClaudeSessionNumbers } from '../../shared/claude-session-numbers'
import { claudeSessionNumbers } from '../claude/claude-session-numbers'

const MAX_PATHS_PER_CALL = 64

export function registerClaudeSessionNumbersHandlers(): void {
  ipcMain.removeHandler('claudeSessionNumbers:get')
  ipcMain.handle(
    'claudeSessionNumbers:get',
    (_event, transcriptPaths: unknown): Record<string, ClaudeSessionNumbers> => {
      const out: Record<string, ClaudeSessionNumbers> = {}
      if (!Array.isArray(transcriptPaths)) {
        return out
      }
      for (const path of transcriptPaths.slice(0, MAX_PATHS_PER_CALL)) {
        if (typeof path !== 'string') {
          continue
        }
        const numbers = claudeSessionNumbers(path)
        if (numbers) {
          out[path] = numbers
        }
      }
      return out
    }
  )
}
