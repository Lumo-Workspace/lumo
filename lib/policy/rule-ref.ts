/**
 * LUM-1114 — resolving a policy rule reference. A compiled rule answers to its
 * own id and to the ids of the duplicate rules merged into it (`aliases`), so
 * a crossing recorded under a rule id before the merge — or a previous policy
 * that still listed the duplicate separately — keeps pointing at a live rule.
 * Pure.
 */
import type { PolicyRule } from './types'

/** Every id the rule answers to: its own first, then its aliases'. */
export function ruleRefs(rule: PolicyRule): string[] {
  return [rule.id, ...(rule.aliases ?? []).map(a => a.id)]
}

/** The rule that answers to `ref` (own id or alias), or undefined. */
export function findRuleByRef(
  rules: readonly PolicyRule[],
  ref: string | null | undefined
): PolicyRule | undefined {
  if (!ref) return undefined
  return (
    rules.find(r => r.id === ref) ??
    rules.find(r => r.aliases?.some(a => a.id === ref))
  )
}

/** The text `ref` names: the rule's own text, or the merged alias's. */
export function ruleTextForRef(
  rules: readonly PolicyRule[],
  ref: string
): string | null {
  const rule = findRuleByRef(rules, ref)
  if (!rule) return null
  if (rule.id === ref) return rule.text
  return rule.aliases?.find(a => a.id === ref)?.text ?? null
}
