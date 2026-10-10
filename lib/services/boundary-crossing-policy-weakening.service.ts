/**
 * LUM-1063 — records POLICY_WEAKENING crossings (LUM-590 / LUM-770 / LUM-780).
 * Core: the judge is deterministic on rule text
 * (`lib/boundary-crossing/policy-weakening.ts`); the rule sets come from
 * whichever policy compiler runs (the security plugin's), which calls this
 * once per new active policy.
 */
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { isReversible } from '@/lib/boundary-crossing/taxonomy'
import {
  policyWeakeningVerdict,
  weakenedRules,
} from '@/lib/boundary-crossing/policy-weakening'
import type { PolicyRule } from '@/lib/policy/types'

export async function recordPolicyWeakening(input: {
  prevRules: readonly PolicyRule[]
  nextRules: readonly PolicyRule[]
  taskId: string
  /** The CLAUDE.md + AGENTS.md text the next rule set was compiled from. */
  source: string
}): Promise<void> {
  for (const r of weakenedRules(input.prevRules, input.nextRules)) {
    const v = policyWeakeningVerdict(r, input.source)
    await boundaryCrossingRepository.create({
      taskId: input.taskId,
      category: 'POLICY_WEAKENING',
      severity: v.severity,
      advisory: v.advisory,
      detail: v.detail,
      target: v.target,
      // LUM-630: route through the taxonomy instead of eating the
      // repository's `?? false` default.
      reversible: isReversible('POLICY_WEAKENING'),
      policyRuleRef: v.policyRuleRef,
      policyRuleText: v.policyRuleText,
    })
  }
}
