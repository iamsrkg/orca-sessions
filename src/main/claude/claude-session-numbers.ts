import { readdir, open, stat } from 'node:fs/promises'
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
const MAX_TRACKED_TRANSCRIPTS = 600
const CHUNK_BYTES = 4 * 1024 * 1024
const inFlight = new Map<string, Promise<TranscriptState>>()
const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
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
async function transcriptFiles(file: string): Promise<string[]> {
  const out = [file]
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(child)
      } else if (child.endsWith('.jsonl')) {
        out.push(child)
      }
    }
  }
  await walk(file.slice(0, -'.jsonl'.length))
  return out
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

function applyLines(
  state: TranscriptState,
  part: string,
  isMain: boolean,
  lines: string[]
): boolean {
  let unordered = false
  const fallbackSessionId = basename(part, '.jsonl')
  for (const line of lines) {
    const match = TIMESTAMP_PATTERN.exec(line)
    const time = match ? Date.parse(match[1]) : Number.NaN
    if (Number.isFinite(time)) {
      if (time < (state.times.at(-1) ?? 0)) {
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
  return unordered
}

// Reads only bytes appended since the last call, in chunks with event-loop yields, so big chats never freeze the app.
async function readTranscript(file: string): Promise<TranscriptState> {
  let state = states.get(file) ?? freshState()
  let unordered = false
  for (const part of await transcriptFiles(file)) {
    let size: number
    try {
      size = (await stat(part)).size
    } catch {
      continue
    }
    let offset = state.offsets.get(part) ?? 0
    if (size < offset) {
      // A rewritten transcript starts over from the beginning.
      state = freshState()
      states.set(file, state)
      return readTranscript(file)
    }
    if (size === offset) {
      continue
    }
    const handle = await open(part, 'r')
    try {
      let carry = Buffer.alloc(0)
      while (offset + carry.length < size) {
        const length = Math.min(CHUNK_BYTES, size - offset - carry.length)
        const chunk = Buffer.alloc(length)
        await handle.read(chunk, 0, length, offset + carry.length)
        const data = Buffer.concat([carry, chunk])
        const end = data.lastIndexOf(10) + 1
        if (end === 0) {
          carry = data
          continue
        }
        const lines = data.subarray(0, end).toString('utf8').split('\n')
        if (applyLines(state, part, part === file, lines)) {
          unordered = true
        }
        offset += end
        carry = data.subarray(end)
        await yieldToEventLoop()
      }
    } finally {
      await handle.close()
    }
    // A half-written last line waits for the next read.
    state.offsets.set(part, offset)
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

export async function claudeSessionNumbers(
  transcriptPath: string
): Promise<ClaudeSessionNumbers | null> {
  if (!isClaudeTranscriptPath(transcriptPath)) {
    return null
  }
  // Concurrent callers of one file share a read, so offsets never advance twice.
  let reading = inFlight.get(transcriptPath)
  if (!reading) {
    reading = readTranscript(transcriptPath).finally(() => inFlight.delete(transcriptPath))
    inFlight.set(transcriptPath, reading)
  }
  const state = await reading
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
