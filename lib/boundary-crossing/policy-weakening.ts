/**
 * LUM-1063 (decision Q2 on LUM-1058) — the POLICY_WEAKENING judge, the part
 * of project-policy detection that is deterministic on the rule TEXT and so
 * stays in the MIT core. Pure. Moved out of the policy compiler's
 * `emitWeakening` verbatim; the compiler (a plugin: it classifies rules with
 * an LLM) hands the core its previous and next rule sets plus the source it
 * just read, and the core decides and records
 * (`lib/services/boundary-crossing-policy-weakening.service.ts`). The LUM-780
 * re-judge of the same rows is core as well (`rejudge-cause.ts`).
 *
 * Which rules are deterministic+blocking at all is the compiler's (LLM)
 * answer; whether one of them was removed by a person is this module's.
 *
 * The discriminator is NOT "did the rule set change" — it is **is the rule's
 * text still in the source**. Those are different questions, and conflating
 * them is what made this detector cry wolf:
 *
 *  - `sourceHash` is salted with COMPILER_VERSION, so bumping the compiler
 *    forces a recompile of an UNCHANGED CLAUDE.md. LUM-770 bumped it, and its
 *    own safety net — which deliberately downgrades an obligation carrying a
 *    cmd-substr predicate — then reported itself as a HIGH policy weakening.
 *  - rule identity is `sha256(text)` of LLM-extracted text, so a classifier
 *    that paraphrases by one character produces a new id and the old one reads
 *    as "removed". Observed 4 times for one untouched rule in a single day.
 *
 * A rule whose text is still in the file was not weakened by a person. That is
 * still worth recording — a classifier that quietly stops treating a Forbidden
 * line as deterministic leaves the project less protected in practice — but as
 * ADVISORY, attributed to the compiler, and not blocking anyone's DONE.
 *
 * A same-id difference is definitionally this case: the id IS the text hash, so
 * identical id means identical text means nobody edited that rule.
 */
import type { BoundaryCrossingSeverity } from '@prisma/client'
import type { PolicyRule } from '@/lib/policy/types'
import { findRuleByRef } from '@/lib/policy/rule-ref'
import { ruleTextPresentIn } from './rejudge-cause'

/** The deterministic+blocking rules of `prev` that `next` removed or
 *  downgraded. */
export function weakenedRules(
  prevRules: readonly PolicyRule[],
  nextRules: readonly PolicyRule[]
): PolicyRule[] {
  return prevRules.filter(r => {
    if (!(r.tier === 'deterministic' && r.blocking)) return false
    // LUM-1114: a rule merged into another as an alias is still compiled.
    const next = findRuleByRef(nextRules, r.id)
    if (next == null) return true // removed
    return !(next.tier === 'deterministic' && next.blocking) // downgraded
  })
}

export interface PolicyWeakeningVerdict {
  severity: BoundaryCrossingSeverity
  advisory: boolean
  detail: string
  target: string
  policyRuleRef: string
  policyRuleText: string
}

/**
 * The crossing one weakened rule becomes: HIGH + blocking when its text is
 * gone from the source (a person removed it), MEDIUM + advisory when the text
 * is still there (a classifier decision, not an edit).
 */
export function policyWeakeningVerdict(
  rule: PolicyRule,
  source: string
): PolicyWeakeningVerdict {
  // LUM-780: one shared predicate with the re-judge (tolerates a trailing
  // classifier gloss on the rule side; the source is never loosened).
  const stillInSource = ruleTextPresentIn(source, rule.text)
  const detail = stillInSource
    ? `The policy compiler stopped treating this rule as deterministic+blocking, but its text is UNCHANGED in CLAUDE.md — a classifier decision, not an edit: "${rule.text}"`
    : `A deterministic Forbidden rule was removed from CLAUDE.md: "${rule.text}"`
  return {
    severity: stillInSource ? 'MEDIUM' : 'HIGH',
    advisory: stillInSource,
    detail,
    target: `weakening:${rule.id}`,
    policyRuleRef: rule.id,
    // LUM-780: the text the re-judge asks the source about — stamped so a
    // future pass never has to recover it from a clipped detail.
    policyRuleText: rule.text,
  }
}
