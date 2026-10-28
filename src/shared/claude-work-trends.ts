/** One local day of Claude work: hours worked (parallel chats counted once) and estimated API cost. */
export type ClaudeWorkTrendDay = {
  /** Local date, YYYY-MM-DD. */
  day: string
  workingMs: number
  costUsd: number
}

export const CLAUDE_WORK_TREND_DAYS = 183
