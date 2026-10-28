import { ipcRenderer } from 'electron'
import type { ClaudeSessionNumbers } from '../../shared/claude-session-numbers'
import type { ClaudeWorkTrendDay } from '../../shared/claude-work-trends'
import type { PreloadApi } from '../api-types'

export const claudeSessionNumbersApi = {
  get: (transcriptPaths: string[]): Promise<Record<string, ClaudeSessionNumbers>> =>
    ipcRenderer.invoke('claudeSessionNumbers:get', transcriptPaths),
  trends: (): Promise<ClaudeWorkTrendDay[]> => ipcRenderer.invoke('claudeSessionNumbers:trends')
} satisfies PreloadApi['claudeSessionNumbers']
