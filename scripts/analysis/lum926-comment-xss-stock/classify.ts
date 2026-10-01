/**
 * LUM-926 — PURE. Says which XSS-shaped markup a stored comment body still
 * carries, and where the body came from. Only literal markup counts: an
 * escaped `&lt;script` is text and renders harmlessly, so it is not a hit.
 */
import { HEADER_MARKER_OPEN } from '@/lib/integrations/github/markdown-bridge'

export type RiskPattern =
  | 'event-handler'
  | 'script'
  | 'javascript-url'
  | 'svg'
  | 'iframe'

const PATTERNS: ReadonlyArray<[RiskPattern, RegExp]> = [
  // on<event>= only inside a tag, so prose like "online=true" is not a hit.
  ['event-handler', /<[a-z][^>]*?[\s/"']on[a-z]+\s*=/i],
  ['script', /<script\b/i],
  ['javascript-url', /<[a-z][^>]*?=\s*["']?\s*javascript\s*:/i],
  ['svg', /<svg\b/i],
  ['iframe', /<iframe\b/i],
]

export const RISK_PATTERNS: readonly RiskPattern[] = PATTERNS.map(([id]) => id)

export function classifyCommentBody(
  body: string | null | undefined
): Set<RiskPattern> {
  const hits = new Set<RiskPattern>()
  if (!body) return hits
  for (const [id, re] of PATTERNS) if (re.test(body)) hits.add(id)
  return hits
}

export type CommentSource =
  | 'task-lumo'
  | 'task-pr-mirror-inbound'
  | 'idea'
  | 'document'

/** Inbound PR-mirror bodies are the only ones built with the mirror header. */
export function commentSource(row: {
  ideaId: string | null
  body: string
}): CommentSource {
  if (row.ideaId) return 'idea'
  return row.body.includes(HEADER_MARKER_OPEN)
    ? 'task-pr-mirror-inbound'
    : 'task-lumo'
}
