/**
 * LUM-1236 follow-up — a recompile must not silently drop a checker.
 *
 * The compiler is a model, and its output is not stable (LUM-1114): the
 * lum1236 recompile of an UNCHANGED CLAUDE.md reworded the Production
 * migration rule and gave it no predicate, so a deterministic, blocking rule
 * became NO_CHECKER — the project was less protected and the only trace was a
 * POLICY_WEAKENING row (which even blamed a person, X953/X954).
 *
 * So, after a recompile: every rule of the PREVIOUS policy that was
 * deterministic + blocking and that the new one removed or downgraded is
 * carried over — re-run through the current post-processing (`compileRuleSet`,
 * so today's safety nets still apply to it) — as long as its text is still in
 * the source (`compiledRuleTextPresentIn`, tolerant of rewording). A rule whose
 * text really left the file is not carried: that is a person's edit, and the
 * POLICY_WEAKENING judge records it HIGH as before.
 *
 * The carried rules are returned separately so the caller records a compiler
 * advisory for each — a kept checker is still a classifier disagreement a
 * human should be able to see. Pure.
 */
import { weakenedRules } from '@/lib/boundary-crossing/policy-weakening'
import { compiledRuleTextPresentIn } from '@/lib/boundary-crossing/rejudge-cause'
import { findRuleByRef } from '@/lib/policy/rule-ref'
import { dedupeRules } from './rule-dedupe'
import type { PolicyRule, RawPolicyRule } from './types'

export interface RetainResult {
  /** The rule set to persist: the new compile plus the carried rules. */
  rules: PolicyRule[]
  /** The previous rules carried over, each with the rule of `rules` that now
   *  answers to its id (itself, or the rule it was merged into). */
  retained: RetainedRule[]
}

export interface RetainedRule {
  previous: PolicyRule
  kept: PolicyRule
  /** The new compile already had an identical check — the carried rule only
   *  merged into it as an alias. Nothing was about to be lost, so this one
   *  needs no advisory. */
  mergedIntoNew: boolean
}

export function retainWeakenedRules(input: {
  prevRules: readonly PolicyRule[]
  nextRules: readonly PolicyRule[]
  source: string
  /** The compiler's post-processing (`compileRuleSet`) — injected to keep
   *  this module free of the service's import graph. */
  compile: (raw: RawPolicyRule[]) => PolicyRule[]
}): RetainResult {
  const keep = weakenedRules(input.prevRules, input.nextRules).filter(r =>
    compiledRuleTextPresentIn(input.source, r.text)
  )
  if (keep.length === 0) return { rules: [...input.nextRules], retained: [] }
  const keepIds = new Set(keep.map(r => r.id))
  // A downgraded copy under the same id is replaced by the carried rule.
  const rest = input.nextRules.filter(n => !keepIds.has(n.id))
  const carried = input.compile(keep.map(r => ({ ...r })))
  const rules = dedupeRules([...rest, ...carried])
  const retained: RetainedRule[] = []
  for (const previous of keep) {
    const kept = findRuleByRef(rules, previous.id)
    // Today's safety nets may downgrade it after all — then it is not kept,
    // and the weakening judge reports it (MEDIUM: the text is still there).
    if (kept && kept.tier === 'deterministic' && kept.blocking)
      retained.push({
        previous,
        kept,
        mergedIntoNew:
          kept.id !== previous.id && rest.some(n => n.id === kept.id),
      })
  }
  return { rules, retained }
}
