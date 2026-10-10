/**
 * LUM-739 — numbered source excerpts for the Hunt tools and the falsifier
 * prompt. Pure; shared by the LLM clients (static `ai` imports) and the
 * service (which must not import them statically).
 */

/** Default cap on one `read_file` answer / snippet, in characters. */
export const SNIPPET_MAX_CHARS = 24_000

export function numberLines(
  source: string,
  start?: number,
  end?: number,
  maxChars = SNIPPET_MAX_CHARS
): string {
  const lines = source.split('\n')
  const from = Math.max(1, start ?? 1)
  const to = Math.min(lines.length, end ?? lines.length)
  const out: string[] = []
  let size = 0
  for (let i = from; i <= to; i++) {
    const line = `${i}: ${lines[i - 1] ?? ''}`
    size += line.length + 1
    if (size > maxChars) {
      out.push('…[truncated]')
      break
    }
    out.push(line)
  }
  return out.join('\n')
}
