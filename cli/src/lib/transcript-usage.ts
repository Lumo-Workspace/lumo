import { readFileSync } from 'node:fs'

export interface SessionUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/** Per-model token usage. Short keys match the ModelCost wire type. */
export interface ModelUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

export interface TranscriptUsage {
  /** Flat cumulative total across all (non-synthetic) models. */
  total: SessionUsage
  /** Cumulative usage keyed by raw model string. */
  byModel: Record<string, ModelUsage>
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Read a Claude Code transcript JSONL and sum `message.usage` across all
 * assistant entries, grouped by `message.model` -> cumulative session totals.
 * `<synthetic>` entries (local injections with no API cost) are skipped.
 * Entries with no model string bucket under "unknown". Best-effort: returns
 * null if the file can't be read or has no real assistant usage. Never throws.
 */
export function sumTranscriptUsage(
  transcriptPath: string
): TranscriptUsage | null {
  let text: string
  try {
    text = readFileSync(transcriptPath, 'utf8')
  } catch {
    return null
  }
  const byModel: Record<string, ModelUsage> = {}
  const total: SessionUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  }
  let seen = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (!obj || typeof obj !== 'object') continue
    const o = obj as {
      type?: unknown
      message?: { model?: unknown; usage?: Record<string, unknown> }
    }
    if (o.type !== 'assistant') continue
    const usage = o.message?.usage
    if (!usage) continue
    const model =
      typeof o.message?.model === 'string' && o.message.model.length > 0
        ? o.message.model
        : 'unknown'
    if (model === '<synthetic>') continue
    seen = true
    const input = asNumber(usage.input_tokens)
    const output = asNumber(usage.output_tokens)
    const cacheRead = asNumber(usage.cache_read_input_tokens)
    const cacheCreation = asNumber(usage.cache_creation_input_tokens)
    total.inputTokens += input
    total.outputTokens += output
    total.cacheReadTokens += cacheRead
    total.cacheCreationTokens += cacheCreation
    const m = byModel[model] ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheCreation: 0,
    }
    m.input += input
    m.output += output
    m.cacheRead += cacheRead
    m.cacheCreation += cacheCreation
    byModel[model] = m
  }
  return seen ? { total, byModel } : null
}
