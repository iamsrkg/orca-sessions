import { ipcRenderer } from 'electron'
import type { ClaudeSessionNumbers } from '../../shared/claude-session-numbers'
import type { PreloadApi } from '../api-types'

export const claudeSessionNumbersApi = {
  get: (transcriptPaths: string[]): Promise<Record<string, ClaudeSessionNumbers>> =>
    ipcRenderer.invoke('claudeSessionNumbers:get', transcriptPaths)
} satisfies PreloadApi['claudeSessionNumbers']
