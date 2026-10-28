/** Per-chat numbers shown on sidebar agent rows: context fill, estimated cost and working time. */
export type ClaudeSessionNumbers = {
  /** Tokens in the context after the newest main-chat reply; null before the first reply. */
  contextTokens: number | null
  contextWindow: number | null
  contextPercent: number | null
  /** API-list-price estimate of the chat and its subagents; null when no priced model was used. */
  costUsd: number | null
  /** Sum of gaps of at most 10 minutes between messages, so time away does not count. */
  workingMs: number
}

export const CLAUDE_SESSION_WORK_GAP_MS = 10 * 60_000

export function formatSessionCost(usd: number | null): string | null {
  if (usd === null || usd < 0.005) {
    return null
  }
  return usd >= 10 ? `$${usd.toFixed(0)}` : `$${usd.toFixed(2)}`
}

export function formatSessionWorkingTime(ms: number): string {
  const hours = ms / 3_600_000
  if (hours < 0.1) {
    return `${Math.max(0, Math.round(ms / 60_000))}m`
  }
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`
}
