import React from 'react'
import { cn } from '@/lib/utils'
import type { AgentStatusEntry } from '../../../../shared/agent-status-types'
import {
  formatSessionCost,
  formatSessionWorkingTime
} from '../../../../shared/claude-session-numbers'
import { useClaudeSessionNumbers } from './claude-session-numbers-store'

function formatTokens(tokens: number): string {
  return tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : `${Math.round(tokens / 1000)}k`
}

/** "ctx 42% · $1.20 · 1.3h" under a Claude agent row: how full its context is, what it cost, how long it worked. */
export const AgentSessionNumbersLine = React.memo(function AgentSessionNumbersLine({
  entry,
  className
}: {
  entry: AgentStatusEntry
  className?: string
}): React.JSX.Element | null {
  const transcriptPath = entry.providerSession?.transcriptPath
  const numbers = useClaudeSessionNumbers(transcriptPath, entry.state)
  if (!numbers) {
    return null
  }
  const percent = numbers.contextPercent
  const cost = formatSessionCost(numbers.costUsd)
  const contextTitle =
    percent !== null && numbers.contextTokens !== null && numbers.contextWindow !== null
      ? `Context ${Math.round(percent)}% full: ${formatTokens(numbers.contextTokens)} of ${formatTokens(numbers.contextWindow)} tokens`
      : 'Context size appears after the first reply'
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 pl-5 text-[10px] leading-snug text-muted-foreground/80 tabular-nums',
        className
      )}
    >
      {percent !== null ? (
        <span
          title={contextTitle}
          className={cn(
            percent >= 85 ? 'text-destructive' : percent >= 60 ? 'text-status-warning' : undefined
          )}
        >
          ctx {Math.round(percent)}%
        </span>
      ) : null}
      {cost ? (
        <span title="Estimated API value of this chat and its subagents at list prices (not money charged on a subscription)">
          {percent !== null ? '· ' : ''}≈{cost}
        </span>
      ) : null}
      <span title="Working time: gaps of up to 10 minutes between messages; time away does not count">
        {percent !== null || cost ? '· ' : ''}
        {formatSessionWorkingTime(numbers.workingMs)}
      </span>
    </div>
  )
})
