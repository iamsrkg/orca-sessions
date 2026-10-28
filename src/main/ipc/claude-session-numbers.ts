import { ipcMain } from 'electron'
import type { ClaudeSessionNumbers } from '../../shared/claude-session-numbers'
import { claudeSessionNumbers } from '../claude/claude-session-numbers'
import { claudeWorkTrends } from '../claude/claude-work-trends'
import { CLAUDE_WORK_TREND_DAYS, type ClaudeWorkTrendDay } from '../../shared/claude-work-trends'

const MAX_PATHS_PER_CALL = 64

let trendsRun: Promise<ClaudeWorkTrendDay[]> | null = null

export function registerClaudeSessionNumbersHandlers(): void {
  ipcMain.removeHandler('claudeSessionNumbers:get')
  ipcMain.removeHandler('claudeSessionNumbers:trends')
  // One scan at a time; callers arriving mid-scan share its result.
  ipcMain.handle('claudeSessionNumbers:trends', () => {
    trendsRun ??= claudeWorkTrends(CLAUDE_WORK_TREND_DAYS).finally(() => {
      trendsRun = null
    })
    return trendsRun
  })
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
