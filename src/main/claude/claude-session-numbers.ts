import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { basename, join, sep } from 'node:path'
import {
  CLAUDE_SESSION_WORK_GAP_MS,
  type ClaudeSessionNumbers
} from '../../shared/claude-session-numbers'
import { estimateCostUsd, longContextTurnTokens } from '../claude-usage/claude-model-pricing'
import { parseClaudeUsageSourceRecord } from '../claude-usage/transcript-record-parser'

type TranscriptState = {
  offsets: Map<string, number>
  times: number[]
  costByKey: Map<string, number>
  contextTokens: number | null
  contextModel: string | null
}

const states = new Map<string, TranscriptState>()
const MAX_TRACKED_TRANSCRIPTS = 200
const TIMESTAMP_PATTERN = /"timestamp":"([^"]+)"/

/** 1M-token windows for current Opus/Sonnet 5 and Fable/Mythos models, 200k otherwise. */
function contextWindowFor(model: string | null, tokens: number): number {
  if (tokens > 200_000 || /\[1m\]|opus-5|sonnet-5|fable|mythos/i.test(model ?? '')) {
    return 1_000_000
  }
  return 200_000
}

function isClaudeTranscriptPath(path: string): boolean {
  return path.endsWith('.jsonl') && path.includes(`${sep}projects${sep}`)
}

// Subagent transcripts live in <session>/subagents/*.jsonl; their work fills the main chat's wait.
function transcriptFiles(file: string): string[] {
  const out = [file]
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(child)
      } else if (child.endsWith('.jsonl')) {
        out.push(child)
      }
    }
  }
  walk(file.slice(0, -'.jsonl'.length))
  return out
}

// Complete lines appended since `offset`; a half-written last line waits for the next read.
function readNewLines(
  file: string,
  offset: number
): { lines: string[]; offset: number } | 'reset' | null {
  let size: number
  try {
    size = statSync(file).size
  } catch {
    return null
  }
  if (size < offset) {
    return 'reset'
  }
  if (size === offset) {
    return { lines: [], offset }
  }
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.alloc(size - offset)
    readSync(fd, buffer, 0, buffer.length, offset)
    const end = buffer.lastIndexOf(10) + 1
    return {
      lines: buffer.subarray(0, end).toString('utf8').split('\n'),
      offset: offset + end
    }
  } finally {
    closeSync(fd)
  }
}

function freshState(): TranscriptState {
  return {
    offsets: new Map(),
    times: [],
    costByKey: new Map(),
    contextTokens: null,
    contextModel: null
  }
}

function readTranscript(file: string): TranscriptState {
  let state = states.get(file) ?? freshState()
  let unordered = false
  for (const part of transcriptFiles(file)) {
    const read = readNewLines(part, state.offsets.get(part) ?? 0)
    if (read === 'reset') {
      // A rewritten transcript starts over from the beginning.
      state = freshState()
      states.set(file, state)
      return readTranscript(file)
    }
    if (!read || read.lines.length === 0) {
      continue
    }
    state.offsets.set(part, read.offset)
    const isMain = part === file
    const fallbackSessionId = basename(part, '.jsonl')
    for (const line of read.lines) {
      const match = TIMESTAMP_PATTERN.exec(line)
      const time = match ? Date.parse(match[1]) : Number.NaN
      if (Number.isFinite(time)) {
        const last = state.times.at(-1) ?? 0
        if (time < last) {
          unordered = true
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
      // One API reply is saved as several lines with the same usage; streaming rows can grow, so keep the largest.
      const key = turn.dedupeKey ?? `${part}:${state.costByKey.size}`
      state.costByKey.set(key, Math.max(state.costByKey.get(key) ?? 0, cost))
      if (isMain && !line.includes('"isSidechain":true')) {
        state.contextTokens =
          turn.inputTokens + turn.cacheReadTokens + turn.cacheWriteTokens + turn.outputTokens
        state.contextModel = turn.model
      }
    }
  }
  if (unordered) {
    state.times.sort((a, b) => a - b)
  }
  if (!states.has(file)) {
    if (states.size >= MAX_TRACKED_TRANSCRIPTS) {
      const oldest = states.keys().next().value
      if (oldest !== undefined) {
        states.delete(oldest)
      }
    }
    states.set(file, state)
  }
  return state
}

export function claudeSessionNumbers(transcriptPath: string): ClaudeSessionNumbers | null {
  if (!isClaudeTranscriptPath(transcriptPath)) {
    return null
  }
  const state = readTranscript(transcriptPath)
  let workingMs = 0
  for (let i = 1; i < state.times.length; i++) {
    const gap = state.times[i] - state.times[i - 1]
    if (gap > 0 && gap <= CLAUDE_SESSION_WORK_GAP_MS) {
      workingMs += gap
    }
  }
  let costUsd = 0
  for (const value of state.costByKey.values()) {
    costUsd += value
  }
  const contextWindow =
    state.contextTokens === null ? null : contextWindowFor(state.contextModel, state.contextTokens)
  return {
    contextTokens: state.contextTokens,
    contextWindow,
    contextPercent:
      state.contextTokens === null || contextWindow === null
        ? null
        : Math.min(100, (state.contextTokens / contextWindow) * 100),
    costUsd: state.costByKey.size > 0 ? costUsd : null,
    workingMs
  }
}
