/** Token + loop cost lifted from a `claude --output-format stream-json` run. */
export interface RunUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  loopCount: number
}

function asNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Parse the final `type: "result"` message of a stream-json claude run.
 * Accepts either the whole stdout log or a single result line. Scans for the
 * LAST parseable line whose `type === 'result'` and lifts `usage.*` +
 * `num_turns`. Returns null when no result line is present (agent crashed or
 * timed out before emitting one) — callers leave the cost columns null.
 */
export function parseStreamJsonUsage(text: string): RunUsage | null {
  if (!text) return null
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim()
    if (!line) continue
    let obj: unknown
    try {
      obj = JSON.parse(line)
    } catch {
      continue
    }
    if (
      obj &&
      typeof obj === 'object' &&
      (obj as { type?: unknown }).type === 'result'
    ) {
      const r = obj as { num_turns?: unknown; usage?: Record<string, unknown> }
      const usage = r.usage ?? {}
      return {
        inputTokens: asNumber(usage['input_tokens']),
        outputTokens: asNumber(usage['output_tokens']),
        cacheReadTokens: asNumber(usage['cache_read_input_tokens']),
        cacheCreationTokens: asNumber(usage['cache_creation_input_tokens']),
        loopCount: asNumber(r.num_turns),
      }
    }
  }
  return null
}
