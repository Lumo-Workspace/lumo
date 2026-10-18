/**
 * LUM-1063 — records POLICY_WEAKENING crossings (LUM-590 / LUM-770 / LUM-780).
 * Core: the judge is deterministic on rule text
 * (`lib/boundary-crossing/policy-weakening.ts`); the rule sets come from
 * whichever policy compiler runs (the security plugin's), which calls this
 * once per new active policy.
 *
 * LUM-1068 — a second, core rule source: the `## Forbidden` list items of
 * CLAUDE.md / AGENTS.md parsed without a model
 * (`lib/boundary-crossing/forbidden-rules.ts`, driven by
 * `forbidden-rule-source.service.ts`). With the plugin installed both sources
 * see the same deletion, so one removal must still be ONE row:
 *
 *  - the core source records a removed rule only when no OPEN
 *    POLICY_WEAKENING row of the project on the same side of the advisory
 *    line already names that rule (plugin row or its own earlier row);
 *  - the plugin path (`recordPolicyWeakening`) skips a rule an OPEN core row
 *    on the same side already names. Without core rows it behaves exactly as
 *    before.
 *
 * "Names the same rule" is the rule id between two core rows, and
 * `sameRuleText` (normalised equality or containment — the plugin's text is
 * the LLM's extraction of the line) across the two sources. Once the row is
 * ruled on (any disposition), a later removal records again. The check and
 * the insert are not one transaction: two instances racing within
 * milliseconds could still both record.
 */
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { logger } from '@/lib/logger'
import { isReversible } from '@/lib/boundary-crossing/taxonomy'
import {
  policyWeakeningVerdict,
  weakenedRules,
} from '@/lib/boundary-crossing/policy-weakening'
import {
  FORBIDDEN_RULE_REF_PREFIX,
  forbiddenRuleWeakeningVerdict,
  sameRuleText,
  type ForbiddenRule,
} from '@/lib/boundary-crossing/forbidden-rules'
import type { PolicyRule } from '@/lib/policy/types'

/** Open rows' rule (ref + text) per advisory side, read once per call. */
interface OpenRule {
  ref: string | null
  text: string
}
type OpenRuleTexts = Map<boolean, OpenRule[]>

async function openRuleTexts(input: {
  projectId: string
  advisory: boolean
  ruleRefPrefix?: string
  cache: OpenRuleTexts
}): Promise<OpenRule[]> {
  const hit = input.cache.get(input.advisory)
  if (hit) return hit
  const rows = await boundaryCrossingRepository.findOpenPolicyWeakeningRules({
    projectId: input.projectId,
    advisory: input.advisory,
    ...(input.ruleRefPrefix ? { ruleRefPrefix: input.ruleRefPrefix } : {}),
  })
  const open = rows
    .filter(r => r.policyRuleText != null && r.policyRuleText.trim() !== '')
    .map(r => ({ ref: r.policyRuleRef, text: r.policyRuleText as string }))
  input.cache.set(input.advisory, open)
  return open
}

/**
 * Does an open row already name this rule? Two core rows are the same rule
 * only by id (two Forbidden lines where one contains the other are two
 * rules); across sources (the plugin's LLM text vs a literal line) by
 * `sameRuleText`.
 */
function namesRule(open: OpenRule, ref: string, text: string): boolean {
  const coreOpen = open.ref?.startsWith(FORBIDDEN_RULE_REF_PREFIX) ?? false
  const coreNew = ref.startsWith(FORBIDDEN_RULE_REF_PREFIX)
  if (coreOpen && coreNew) return open.ref === ref
  return sameRuleText(open.text, text)
}

async function projectIdOfTask(taskId: string): Promise<string | null> {
  const task = await taskRepository.findWithProjectWorkspaceId(taskId)
  return task?.projectId ?? null
}

export async function recordPolicyWeakening(input: {
  prevRules: readonly PolicyRule[]
  nextRules: readonly PolicyRule[]
  taskId: string
  /** The CLAUDE.md + AGENTS.md text the next rule set was compiled from. */
  source: string
}): Promise<void> {
  const weakened = weakenedRules(input.prevRules, input.nextRules)
  if (weakened.length === 0) return
  // LUM-1068: the open core-source rows this removal may already be. Best
  // effort — an unreadable dedupe state records (visibility over silence).
  let projectId: string | null = null
  try {
    projectId = await projectIdOfTask(input.taskId)
  } catch {
    projectId = null
  }
  const cache: OpenRuleTexts = new Map()
  for (const r of weakened) {
    const v = policyWeakeningVerdict(r, input.source)
    if (projectId) {
      try {
        const open = await openRuleTexts({
          projectId,
          advisory: v.advisory,
          ruleRefPrefix: FORBIDDEN_RULE_REF_PREFIX,
          cache,
        })
        if (open.some(o => namesRule(o, v.policyRuleRef, v.policyRuleText)))
          continue
      } catch (error) {
        logger.warn(
          `[policy-weakening] dedupe read failed for project ${projectId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }
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

/**
 * LUM-1068 — the core Forbidden source's removed rules → POLICY_WEAKENING
 * (HIGH + blocking when the text is gone, MEDIUM + advisory when it is still
 * in the source; same line as `recordPolicyWeakening`). A rule an OPEN row of
 * the project already names on the same side is skipped (see the header).
 * Returns the rows written.
 */
export async function recordForbiddenRuleWeakening(input: {
  removed: readonly ForbiddenRule[]
  taskId: string
  projectId: string
  /** The CLAUDE.md + AGENTS.md text the removal was observed in. */
  source: string
}): Promise<number> {
  const cache: OpenRuleTexts = new Map()
  let written = 0
  for (const rule of input.removed) {
    const v = forbiddenRuleWeakeningVerdict(rule, input.source)
    const open = await openRuleTexts({
      projectId: input.projectId,
      advisory: v.advisory,
      cache,
    })
    if (open.some(o => namesRule(o, v.policyRuleRef, v.policyRuleText)))
      continue
    await boundaryCrossingRepository.create({
      taskId: input.taskId,
      category: 'POLICY_WEAKENING',
      severity: v.severity,
      advisory: v.advisory,
      detail: v.detail,
      target: v.target,
      reversible: isReversible('POLICY_WEAKENING'),
      policyRuleRef: v.policyRuleRef,
      policyRuleText: v.policyRuleText,
    })
    // Two removed rules of one edit can share wording; the second must see
    // the first.
    open.push({ ref: v.policyRuleRef, text: v.policyRuleText })
    written++
  }
  return written
}

/**
 * LUM-1236 follow-up — the compiler kept a previous deterministic+blocking
 * rule its new output dropped or downgraded (the rule's text is still in the
 * source; ee/security/services/policy/retain-rules). Protection did not
 * weaken, but the classifier disagreed with itself, and that must not be
 * silent: one MEDIUM, ADVISORY POLICY_WEAKENING row per kept rule, attributed
 * to the compiler. Skipped when an OPEN advisory row of the project already
 * names the rule (a classifier that keeps flip-flopping is one row until a
 * human looks). Returns the rows written.
 */
export async function recordRetainedRules(input: {
  retained: readonly { id: string; text: string }[]
  taskId: string
}): Promise<number> {
  if (input.retained.length === 0) return 0
  let projectId: string | null = null
  try {
    projectId = await projectIdOfTask(input.taskId)
  } catch {
    projectId = null
  }
  const cache: OpenRuleTexts = new Map()
  let written = 0
  for (const rule of input.retained) {
    if (projectId) {
      try {
        const open = await openRuleTexts({
          projectId,
          advisory: true,
          cache,
        })
        if (open.some(o => o.ref === rule.id)) continue
      } catch (error) {
        logger.warn(
          `[policy-weakening] dedupe read failed for project ${projectId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
    }
    await boundaryCrossingRepository.create({
      taskId: input.taskId,
      category: 'POLICY_WEAKENING',
      severity: 'MEDIUM',
      advisory: true,
      detail: `The policy compiler's new output dropped or downgraded this deterministic rule although its text is still in CLAUDE.md/AGENTS.md; the previous checker was kept: "${rule.text}"`,
      target: `weakening:${rule.id}`,
      reversible: isReversible('POLICY_WEAKENING'),
      policyRuleRef: rule.id,
      policyRuleText: rule.text,
    })
    written++
  }
  return written
}
