/**
 * LUM-751 — pure helpers for repository-level crossing suppression rules.
 *
 * A human who dispositions a crossing FALSE_POSITIVE may opt the whole
 * repository out of that (category, target) shape from then on. The detector
 * still RECORDS every later match (audit trail intact) but stamps it with the
 * system disposition AUTO_SUPPRESSED + the rule's id — out of the open queue,
 * out of the DONE gate (both key on `disposition: null`), visible in the panel
 * as "auto-dispositioned by rule". Red lines: a rule is created only by a human
 * (Clerk, via the disposition route), never for the HIGH classes below, and an
 * evasion-decoded crossing is never suppressed (checked at the detector).
 */
import type { BoundaryCrossingCategory } from '@prisma/client'

/** The HIGH classes: always a human decision, never rule-suppressible. */
export const NON_SUPPRESSIBLE_CATEGORIES: ReadonlySet<BoundaryCrossingCategory> =
  new Set<BoundaryCrossingCategory>([
    'HARDCODED_SECRET',
    'DESTRUCTIVE_DB_COMMAND',
    'EXFILTRATION_PUBLIC',
    'CLOUD_DATA_DELETION',
    'INFRA_TERMINATION',
  ])

export function isSuppressibleCategory(c: BoundaryCrossingCategory): boolean {
  return !NON_SUPPRESSIBLE_CATEGORIES.has(c)
}

/** The slice of a CrossingSuppressionRule the detector needs. */
export interface ActiveSuppressionRule {
  id: string
  category: BoundaryCrossingCategory
  targetPattern: string
  reason: string | null
}

/** Exact target (the LUM-477 coalescing key), or a `prefix*` pattern. A null
 *  target (no coalescing key) never matches — nothing to anchor a rule on. */
export function matchesSuppressionTarget(
  pattern: string,
  target: string | null
): boolean {
  if (target == null) return false
  if (pattern.endsWith('*')) return target.startsWith(pattern.slice(0, -1))
  return pattern === target
}

export function findSuppressionRule(
  rules: ActiveSuppressionRule[],
  category: BoundaryCrossingCategory,
  target: string | null
): ActiveSuppressionRule | null {
  if (!isSuppressibleCategory(category)) return null
  return (
    rules.find(
      r =>
        r.category === category &&
        matchesSuppressionTarget(r.targetPattern, target)
    ) ?? null
  )
}

/** The system disposition note stamped on an auto-suppressed crossing. */
export function autoSuppressedNote(rule: ActiveSuppressionRule): string {
  const why = rule.reason ? `: ${rule.reason}` : ''
  return `Auto-dispositioned by repository suppression rule ${rule.id}${why}. Not a human disposition — revoke the rule to re-open future occurrences.`
}
