import { readFileSync } from 'node:fs'

export interface SessionUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Read a Claude Code transcript JSONL and sum `message.usage` across all
 * assistant entries -> cumulative session token totals. Best-effort: returns
 * null if the file can't be read or has no assistant usage. Never throws.
 */
export function sumTranscriptUsage(
  transcriptPath: string
): SessionUsage | null {
  let text: string
  try {
    text = readFileSync(transcriptPath, 'utf8')
  } catch {
    return null
  }
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
      message?: { usage?: Record<string, unknown> }
    }
    if (o.type !== 'assistant') continue
    const usage = o.message?.usage
    if (!usage) continue
    seen = true
    total.inputTokens += asNumber(usage.input_tokens)
    total.outputTokens += asNumber(usage.output_tokens)
    total.cacheReadTokens += asNumber(usage.cache_read_input_tokens)
    total.cacheCreationTokens += asNumber(usage.cache_creation_input_tokens)
  }
  return seen ? total : null
}
