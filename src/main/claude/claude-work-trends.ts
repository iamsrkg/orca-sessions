import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { CLAUDE_SESSION_WORK_GAP_MS } from '../../shared/claude-session-numbers'
import type { ClaudeWorkTrendDay } from '../../shared/claude-work-trends'
import { estimateCostUsd, longContextTurnTokens } from '../claude-usage/claude-model-pricing'
import { listClaudeTranscriptFiles } from '../claude-usage/transcript-file-discovery'
import { parseClaudeUsageSourceRecord } from '../claude-usage/transcript-record-parser'

type FileState = {
  offset: number
  times: number[]
  sorted: boolean
  costs: Map<string, { cost: number; day: string }>
}

const files = new Map<string, FileState>()
const TIMESTAMP_PATTERN = /"timestamp":"([^"]+)"/
const DAY_MS = 86_400_000

const dayKey = (time: number): string => new Date(time).toLocaleDateString('en-CA')

async function readAppended(path: string, state: FileState): Promise<void> {
  const info = await stat(path)
  if (info.size < state.offset) {
    state.offset = 0
    state.times = []
    state.costs = new Map()
  }
  if (info.size === state.offset) {
    return
  }
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(info.size - state.offset)
    await handle.read(buffer, 0, buffer.length, state.offset)
    const end = buffer.lastIndexOf(10) + 1
    state.offset += end
    const fallbackSessionId = basename(path, '.jsonl')
    for (const line of buffer.subarray(0, end).toString('utf8').split('\n')) {
      const match = TIMESTAMP_PATTERN.exec(line)
      const time = match ? Date.parse(match[1]) : Number.NaN
      if (Number.isFinite(time)) {
        if (time < (state.times.at(-1) ?? 0)) {
          state.sorted = false
        }
        state.times.push(time)
      }
      const turn = parseClaudeUsageSourceRecord(line, fallbackSessionId)
      if (!turn) {
        continue
      }
      const cost =
        estimateCostUsd(turn.model, {
          ...turn,
          longContext: longContextTurnTokens(turn.model, turn)
        }) ?? 0
      const key = turn.dedupeKey ?? `${path}:${state.costs.size}`
      const previous = state.costs.get(key)
      if (!previous || cost > previous.cost) {
        state.costs.set(key, { cost, day: dayKey(Date.parse(turn.timestamp) || time) })
      }
    }
  } finally {
    await handle.close()
  }
}

// Add the interval [start, end] to per-day totals, split at local midnight.
function addSpan(totals: Map<string, number>, start: number, end: number): void {
  let from = start
  while (from < end) {
    const midnight = new Date(from)
    midnight.setHours(24, 0, 0, 0)
    const to = Math.min(end, midnight.getTime())
    const key = dayKey(from)
    totals.set(key, (totals.get(key) ?? 0) + (to - from))
    from = to
  }
}

/**
 * Hours worked and estimated cost per day for the last `days` days, across every local Claude transcript.
 * Hours are the UNION of each chat's busy stretches (message gaps of at most 10 minutes), so parallel chats
 * count once; cost uses Orca's price table, each API reply once even when forks copy it into several files.
 */
export async function claudeWorkTrends(days: number): Promise<ClaudeWorkTrendDay[]> {
  const cutoff = Date.now() - days * DAY_MS
  const paths = await listClaudeTranscriptFiles()
  const spans: [number, number][] = []
  const costs = new Map<string, { cost: number; day: string }>()
  for (const path of paths) {
    let info
    try {
      info = await stat(path)
    } catch {
      continue
    }
    if (info.mtimeMs < cutoff) {
      continue
    }
    const state = files.get(path) ?? { offset: 0, times: [], sorted: true, costs: new Map() }
    files.set(path, state)
    try {
      await readAppended(path, state)
    } catch {
      continue
    }
    if (!state.sorted) {
      state.times.sort((a, b) => a - b)
      state.sorted = true
    }
    let spanStart: number | null = null
    let previous = 0
    for (const time of state.times) {
      if (spanStart !== null && time - previous > CLAUDE_SESSION_WORK_GAP_MS) {
        spans.push([spanStart, previous])
        spanStart = null
      }
      spanStart ??= time
      previous = time
    }
    if (spanStart !== null && previous > spanStart) {
      spans.push([spanStart, previous])
    }
    for (const [key, value] of state.costs) {
      const seen = costs.get(key)
      if (!seen || value.cost > seen.cost) {
        costs.set(key, value)
      }
    }
    // Let IPC and timers run between files: the first scan can read hundreds of MB.
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  spans.sort((a, b) => a[0] - b[0])
  const workByDay = new Map<string, number>()
  let mergedStart: number | null = null
  let mergedEnd = 0
  for (const [start, end] of spans) {
    if (mergedStart !== null && start <= mergedEnd) {
      mergedEnd = Math.max(mergedEnd, end)
      continue
    }
    if (mergedStart !== null) {
      addSpan(workByDay, mergedStart, mergedEnd)
    }
    mergedStart = start
    mergedEnd = end
  }
  if (mergedStart !== null) {
    addSpan(workByDay, mergedStart, mergedEnd)
  }
  const costByDay = new Map<string, number>()
  for (const { cost, day } of costs.values()) {
    costByDay.set(day, (costByDay.get(day) ?? 0) + cost)
  }
  const out: ClaudeWorkTrendDay[] = []
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(today.getDate() - i)
    const day = dayKey(date.getTime())
    out.push({ day, workingMs: workByDay.get(day) ?? 0, costUsd: costByDay.get(day) ?? 0 })
  }
  return out
}
