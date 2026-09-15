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
    // LUM-750: an agent ruling on its own blocker is never a repository-wide
    // false positive — no rule may ever auto-clear it.
    'SELF_DISPOSITION',
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

/**
 * LUM-771 — the stored pattern for a rule that must match one crossing target
 * EXACTLY. A trailing `*` is the prefix-rule marker, so a target that itself
 * ends in `*` (`rm -rf __tests__/*`) is escaped as `\*`; stored verbatim it
 * would silently become a prefix rule over every `rm -rf __tests__/<file>`.
 * Every rule the service creates from a crossing goes through this.
 */
export function exactSuppressionPattern(target: string): string {
  return target.endsWith('*') ? `${target.slice(0, -1)}\\*` : target
}

/** Exact target (the LUM-477 coalescing key), or a `prefix*` pattern. A null
 *  target (no coalescing key) never matches — nothing to anchor a rule on.
 *  A pattern ending in the escaped `\*` (LUM-771) is an exact match on a
 *  star-terminated target, never a prefix. */
export function matchesSuppressionTarget(
  pattern: string,
  target: string | null
): boolean {
  if (target == null) return false
  const filter = suppressionTargetFilter(pattern)
  return filter.kind === 'prefix'
    ? target.startsWith(filter.value)
    : target === filter.value
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

/**
 * LUM-759 — how many already-recorded crossings one rule creation may
 * retroactively dispose. A ceiling, not a target: the sweep takes the most
 * recently detected matches up to this many and reports that it stopped, so a
 * single click can never silently rewrite an unbounded slice of the audit
 * trail. The long tail stays where it is (advisory rows are harmless) and a
 * second ruling can always take another bite.
 */
export const RETROACTIVE_SUPPRESSION_CAP = 500

/**
 * The two shapes a `targetPattern` can take, as data — the Prisma-free half of
 * {@link matchesSuppressionTarget}, so the repository can turn a pattern into a
 * WHERE clause without either side re-deriving the glob convention.
 */
export type SuppressionTargetFilter =
  | { kind: 'exact'; value: string }
  | { kind: 'prefix'; value: string }

export function suppressionTargetFilter(
  pattern: string
): SuppressionTargetFilter {
  // LUM-771: `\*` is an escaped literal star (exact), `*` alone is the prefix marker.
  if (pattern.endsWith('\\*')) {
    return { kind: 'exact', value: `${pattern.slice(0, -2)}*` }
  }
  return pattern.endsWith('*')
    ? { kind: 'prefix', value: pattern.slice(0, -1) }
    : { kind: 'exact', value: pattern }
}

/** The note stamped on a crossing restored to OPEN by revoking its rule. */
export const RULE_REVOKED_REASON = 'rule revoked'
