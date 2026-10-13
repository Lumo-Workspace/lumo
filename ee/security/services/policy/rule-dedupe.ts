/**
 * LUM-1114 — compile-time de-duplication of a project's policy rules.
 *
 * A rules file often states one rule several times (a convention, a checklist
 * line, a "Forbidden" bullet), and the LLM compiler also emits the very same
 * rule more than once. Each copy is a separate detector, so one violation
 * became up to three crossings — and three human rulings. In production the
 * same `console.log` line was recorded three times.
 *
 * Generic on purpose: two rules merge only when they would DETECT exactly the
 * same thing — same kind, tier, mapped category, predicate and (normalised)
 * assertion. Wording is never compared, so nothing about one tenant's rules
 * file is assumed, and a merge can never lose a detection: the merged rule is
 * the same detector. The first rule (source order) keeps its id and text; the
 * others become `aliases` (ids stay resolvable, see lib/policy/rule-ref).
 * Severity is the highest of the group and the rule blocks if any copy did.
 * Pure.
 */
import type { PolicyRule, PolicyRuleAlias } from './types'

const SEVERITY_RANK: Record<PolicyRule['severity'], number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
}

/** Case, whitespace, quotes and trailing punctuation do not change a check. */
function normalise(text: string | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.;:,!]+$/, '')
    .trim()
}

/** What the rule detects — equal keys mean an identical detector. */
export function detectionKey(rule: PolicyRule): string {
  return [
    rule.kind,
    rule.tier,
    rule.mappedCategory ?? '',
    rule.predicate?.type ?? '',
    rule.predicate?.value.trim() ?? '',
    normalise(rule.assertion),
  ].join('\u0000')
}

function addAlias(into: PolicyRuleAlias[], alias: PolicyRuleAlias): void {
  if (!into.some(a => a.id === alias.id)) into.push(alias)
}

export function dedupeRules(rules: readonly PolicyRule[]): PolicyRule[] {
  const byKey = new Map<string, PolicyRule>()
  const out: PolicyRule[] = []
  for (const rule of rules) {
    const key = detectionKey(rule)
    const kept = byKey.get(key)
    if (!kept) {
      const copy: PolicyRule = { ...rule }
      if (rule.aliases) copy.aliases = [...rule.aliases]
      byKey.set(key, copy)
      out.push(copy)
      continue
    }
    if (SEVERITY_RANK[rule.severity] > SEVERITY_RANK[kept.severity])
      kept.severity = rule.severity
    kept.blocking = kept.blocking || rule.blocking
    const aliases = kept.aliases ?? []
    if (rule.id !== kept.id) addAlias(aliases, { id: rule.id, text: rule.text })
    for (const a of rule.aliases ?? [])
      if (a.id !== kept.id) addAlias(aliases, a)
    if (aliases.length > 0) kept.aliases = aliases
  }
  return out
}
