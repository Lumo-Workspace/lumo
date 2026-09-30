/**
 * Code-rule pipeline service (LUM-590, Task 6).
 *
 * At the IN_REVIEW checkpoint, fetches the PR diff, runs deterministic
 * diff-regex rules (blocking-eligible, advisory: false) and a semantic LLM
 * judge (advisory: true, fail-closed). Persists findings as boundary crossings.
 *
 * Runs in a foreground worker (300s budget via /api/internal/policy-check),
 * NOT in the task route's ~15s waitUntil. This pattern mirrors run-summary
 * (LUM-576) and fold (LUM-555).
 *
 * Judge import is dynamic to keep the @ai-sdk/gateway TransformStream out of
 * the static import graph — the same jest-safe convention used throughout.
 */

import { policyCompilerService } from './policy-compiler.service'
import {
  fetchPrDiff,
  addedLinesFromDiff,
} from '@/lib/integrations/github/contents'
import { matchDiffRegex } from './predicate-eval'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { isReversible } from '@/lib/services/boundary-detector.service'
import { loadSecurityLayers } from '@/lib/services/security-workspace-switches.service'
import type { EffectiveSecurityLayers } from '@/lib/security-scan/workspace-switches'

export interface CodePipelineInput {
  taskId: string
  projectId: string
  workspaceId: string
  /** GitHub "owner/repo" full name for the default linked repository. */
  fullName: string
  /** Latest open PR number. */
  prNumber: number
}

export interface CodePipelineResult {
  /** Number of deterministic diff-regex crossings created (advisory: false). */
  deterministic: number
  /** Number of semantic / judge advisory crossings created (advisory: true). */
  advisory: number
}

/**
 * LUM-901 — why the semantic code rules could not be checked, by the switch
 * that is off: the master scan switch (every layer off) before the AI review
 * switch. null when the judge may run.
 */
export function semanticRulesOffReason(
  layers: Pick<EffectiveSecurityLayers, 'scan' | 'aiReview'>
): { target: string; detail: string } | null {
  if (!layers.scan)
    return {
      target: 'coderule:scanning-off',
      detail:
        "Semantic code rules were not checked: security scanning is turned off in this workspace's settings.",
    }
  if (!layers.aiReview)
    return {
      target: 'coderule:ai-review-off',
      detail:
        "Semantic code rules were not checked: AI review is turned off in this workspace's settings.",
    }
  return null
}

export const codePipelineService = {
  async runForTask(input: CodePipelineInput): Promise<CodePipelineResult> {
    const policy = await policyCompilerService.ensureCompiled(input)
    if (!policy) return { deterministic: 0, advisory: 0 }

    const codeRules = policy.rules.filter(r => r.kind === 'code')
    if (codeRules.length === 0) return { deterministic: 0, advisory: 0 }

    const diff = await fetchPrDiff({
      workspaceId: input.workspaceId,
      fullName: input.fullName,
      prNumber: input.prNumber,
    })

    const perFile = addedLinesFromDiff(diff)
    const allAdded = perFile.flatMap(f => f.addedLines)

    // ── Deterministic diff-regex pass ─────────────────────────────────────────
    let deterministic = 0
    const deterministicRules = codeRules.filter(
      r => r.tier === 'deterministic' && r.predicate?.type === 'diff-regex'
    )
    for (const r of deterministicRules) {
      const hit = matchDiffRegex(r.predicate!.value, allAdded)
      if (hit.matched) {
        await boundaryCrossingRepository.create({
          taskId: input.taskId,
          category: 'PROJECT_RULE_VIOLATION',
          severity: r.severity,
          advisory: false,
          policyRuleRef: r.id,
          target: `coderule:${r.id}`,
          // LUM-630: route through the taxonomy — omitting this ate the
          // repository's `?? false` default and mislabeled diff-only
          // violations as irreversible.
          reversible: isReversible(
            'PROJECT_RULE_VIOLATION',
            `coderule:${r.id}`
          ),
          policyRuleText: r.text,
          detail: hit.line?.trim() ?? '',
        })
        deterministic++
      }
    }

    // ── Semantic judge pass ───────────────────────────────────────────────────
    let advisory = 0
    const semanticRules = codeRules.filter(
      r => r.tier === 'semantic' && r.assertion
    )

    // LUM-892: the semantic judge sends the whole PR diff to a model — the
    // same act the workspace's AI review switch promises to stop. Off = no
    // model call, and one advisory crossing that says the rules were not
    // checked and why (never a silent pass; advisory never blocks DONE).
    // LUM-901: the reason names the switch that is actually off — the master
    // scan switch or the AI review switch — and a re-run on the same task
    // bumps the open crossing instead of adding another row.
    const layers =
      semanticRules.length > 0
        ? await loadSecurityLayers(input.workspaceId)
        : null
    const offReason = layers ? semanticRulesOffReason(layers) : null
    if (semanticRules.length > 0 && offReason) {
      const coalesced = await boundaryCrossingRepository.coalesceRecurrence(
        input.taskId,
        'PROJECT_RULE_VIOLATION',
        offReason.target,
        new Date(),
        true
      )
      if (coalesced === 0) {
        await boundaryCrossingRepository.create({
          taskId: input.taskId,
          category: 'PROJECT_RULE_VIOLATION',
          severity: 'LOW',
          advisory: true,
          target: offReason.target,
          reversible: isReversible('PROJECT_RULE_VIOLATION', offReason.target),
          detail: offReason.detail,
        })
        advisory++
      }
    } else if (semanticRules.length > 0) {
      // Dynamic import keeps @ai-sdk/gateway out of the static import graph
      // (jest TransformStream trap — same pattern as layer2/curation services).
      const { judgeCodeRules } =
        await import('@/lib/llm/code-rule-judge-client')
      try {
        const { violations } = await judgeCodeRules({
          assertions: semanticRules.map(r => ({
            ruleId: r.id,
            assertion: r.assertion!,
          })),
          diff,
        })
        const byId = new Map(semanticRules.map(r => [r.id, r]))
        for (const v of violations) {
          const r = byId.get(v.ruleId)
          if (!r) continue
          await boundaryCrossingRepository.create({
            taskId: input.taskId,
            category: 'PROJECT_RULE_VIOLATION',
            severity: r.severity,
            advisory: true,
            policyRuleRef: r.id,
            target: `coderule:${r.id}`,
            reversible: isReversible(
              'PROJECT_RULE_VIOLATION',
              `coderule:${r.id}`
            ),
            policyRuleText: r.text,
            detail: v.detail,
          })
          advisory++
        }
      } catch {
        // FAIL-CLOSED: if the judge is unavailable (timeout, quota, network),
        // record ONE advisory "could not confirm" crossing — never a silent pass.
        // A silent pass would let a real violation slip through unreviewed.
        await boundaryCrossingRepository.create({
          taskId: input.taskId,
          category: 'PROJECT_RULE_VIOLATION',
          severity: 'LOW',
          advisory: true,
          target: 'coderule:judge-unavailable',
          reversible: isReversible(
            'PROJECT_RULE_VIOLATION',
            'coderule:judge-unavailable'
          ),
          detail:
            'Code-rule semantic check could not be confirmed (judge unavailable).',
        })
        advisory++
      }
    }

    return { deterministic, advisory }
  },
}
