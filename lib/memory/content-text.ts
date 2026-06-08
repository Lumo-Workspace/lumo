import type { MemoryCategory } from '@prisma/client'

/**
 * Flatten a per-category memory content object into a single comparable
 * string, in headline-first field order. Used as both the query text and the
 * pool text for neighbor retrieval — so two memories about the same thing
 * produce overlapping bigrams regardless of which fields they fill.
 *
 * Defensive: content comes from the DB as `unknown` (JSON). Non-object or
 * null content yields '' (no neighbors, never throws).
 */
export function memoryContentToText(
  category: MemoryCategory,
  content: unknown
): string {
  if (content === null || typeof content !== 'object') return ''
  const c = content as Record<string, unknown>
  const parts: string[] = []
  const push = (v: unknown): void => {
    if (typeof v === 'string') {
      const t = v.trim()
      if (t) parts.push(t)
    } else if (Array.isArray(v)) {
      for (const item of v) push(item)
    }
  }
  switch (category) {
    case 'TRAP':
      push(c.summary)
      push(c.trigger)
      push(c.outcome)
      push(c.workaround)
      break
    case 'DECISION':
      push(c.summary)
      push(c.what)
      push(c.why)
      push(c.alternatives)
      push(c.implications)
      break
    case 'CONVENTION':
      push(c.summary)
      push(c.rule)
      push(c.scope)
      break
    case 'PROCEDURAL':
      push(c.summary)
      push(c.workflow)
      push(c.trigger)
      push(c.steps)
      break
  }
  return parts.join(' ')
}
