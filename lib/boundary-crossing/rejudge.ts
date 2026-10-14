/**
 * LUM-772 — pure core of the PROJECT_RULE_VIOLATION backfill
 * (`scripts/backfill-prv-rejudge.ts`): re-judge the OPEN crossings a compiled
 * rule produced against the CURRENT compiler's view of the stored policy.
 *
 * Why: two compiler bugs stamped real work as HIGH/MEDIUM rule violations —
 * the target-blind `cmd-substr: "git push"` (this task) and the LUM-770
 * obligation-as-prohibition — and every open row they left stays in the queue
 * and blocks DONE until a human rules on it. The fix is deterministic, so the
 * rows it would no longer produce can be ruled the same way, with the trail
 * saying exactly why.
 *
 * Honest by construction:
 *   - the command judged is the hook event's FULL command when it is on
 *     record; a `detail` that `clip` truncated is never judged alone
 *     (`TRUNCATED` → left open, reported);
 *   - a project with no stored policy cannot be judged (`NO_POLICY`), nor
 *     can anything when no detector judges project rules (LUM-1063: the
 *     rule matchers are a plugin's);
 *   - a rule whose id no longer exists in the current policy is only a
 *     candidate when NO current deterministic rule matches the command
 *     (`RULE_RETIRED`) — a reworded successor that still matches keeps the
 *     row open (`STILL_MATCHES`);
 *   - this module writes nothing. The plan is data; the script applies it,
 *     and only with `--apply`.
 */
import { findRuleByRef } from '@/lib/policy/rule-ref'
import type { PolicyRule } from '@/lib/policy/types'
import {
  detectProjectActionCrossings,
  isClippedDetail,
  projectRuleDetectionInstalled,
} from '@/lib/services/boundary-detector.service'

/** One OPEN PROJECT_RULE_VIOLATION row as the backfill reads it. */
export interface RejudgeRow {
  id: string
  taskId: string | null
  projectId: string | null
  policyRuleRef: string
  policyRuleText: string | null
  /** The stored (possibly clipped) command text. */
  detail: string
  /** The full command from the originating hook event, when on record. */
  command: string | null
}

export type RejudgeVerdict =
  /** The current detector no longer cites the rule for this command. */
  | 'NO_LONGER_MATCHES'
  /** The rule id is gone from the current policy and no current deterministic
   *  rule matches the command either. */
  | 'RULE_RETIRED'
  /** Still a violation under the current policy — left open. */
  | 'STILL_MATCHES'
  /** Only a clipped detail is on record — cannot be judged, left open. */
  | 'TRUNCATED'
  /** The project has no stored policy — cannot be judged, left open. */
  | 'NO_POLICY'

export interface RejudgeDecision {
  row: RejudgeRow
  verdict: RejudgeVerdict
  /** The command the verdict was reached on (null when nothing judgeable). */
  command: string | null
}

export interface RejudgePlan {
  /** Rows the script may rule FALSE_POSITIVE (`--apply`). */
  candidates: RejudgeDecision[]
  /** Rows left open, with the reason. */
  leftOpen: RejudgeDecision[]
}

/** The command to judge: the full hook command, else an un-clipped detail. */
export function judgeableCommand(row: RejudgeRow): string | null {
  if (row.command != null && row.command.trim().length > 0) return row.command
  return isClippedDetail(row.detail) ? null : row.detail
}

/** Re-judge one row against the project's CURRENT compiled rules. */
export function rejudgeRow(
  row: RejudgeRow,
  currentRules: PolicyRule[] | null
): RejudgeDecision {
  // LUM-1063: the rules are judged by a plugin detector. Without one nothing
  // can be decided — never a "no longer matches" for want of a matcher.
  if (currentRules == null || !projectRuleDetectionInstalled())
    return { row, verdict: 'NO_POLICY', command: null }
  const command = judgeableCommand(row)
  if (command == null) return { row, verdict: 'TRUNCATED', command: null }
  const hits = detectProjectActionCrossings(
    { toolName: 'Bash', payload: { tool_input: { command } } },
    currentRules
  )
  // LUM-1114: the row's rule may since have been merged into another one as
  // an alias — it is still compiled, and that rule's hits are its hits.
  const owner = findRuleByRef(currentRules, row.policyRuleRef)
  if (
    hits.some(
      h =>
        h.policyRuleRef === row.policyRuleRef ||
        (owner != null && h.policyRuleRef === owner.id)
    )
  ) {
    return { row, verdict: 'STILL_MATCHES', command }
  }
  if (owner) return { row, verdict: 'NO_LONGER_MATCHES', command }
  // The id is gone (reworded / removed). Any current deterministic hit on the
  // same command means a successor rule still forbids it — keep it open.
  return hits.length > 0
    ? { row, verdict: 'STILL_MATCHES', command }
    : { row, verdict: 'RULE_RETIRED', command }
}

/**
 * Build the plan for a batch of rows. `currentRulesByProject` holds each
 * project's stored policy run through the current `compileRuleSet`; a project
 * absent from the map has no policy. Pure — no I/O.
 */
export function planRuleRejudge(
  rows: RejudgeRow[],
  currentRulesByProject: ReadonlyMap<string, PolicyRule[]>
): RejudgePlan {
  const plan: RejudgePlan = { candidates: [], leftOpen: [] }
  for (const row of rows) {
    const rules =
      row.projectId != null
        ? (currentRulesByProject.get(row.projectId) ?? null)
        : null
    const decision = rejudgeRow(row, rules)
    if (
      decision.verdict === 'NO_LONGER_MATCHES' ||
      decision.verdict === 'RULE_RETIRED'
    ) {
      plan.candidates.push(decision)
    } else {
      plan.leftOpen.push(decision)
    }
  }
  return plan
}

/** The disposition note stamped on a backfilled row — names the compiler
 *  version and the reason, so the audit trail reads as a system re-judgement
 *  rather than a human ruling. */
export function backfillNote(
  decision: RejudgeDecision,
  compilerVersion: string
): string {
  const rule = `rule ${decision.row.policyRuleRef}${
    decision.row.policyRuleText ? ` ("${decision.row.policyRuleText}")` : ''
  }`
  const reason =
    decision.verdict === 'RULE_RETIRED'
      ? `${rule} no longer compiles to a deterministic predicate and no current rule matches the recorded command`
      : `the recorded command does not match ${rule} — its earlier predicate was target-blind`
  return `[LUM-772 backfill] Re-judged against the current detector (compiler ${compilerVersion}): ${reason}. Auto-ruled FALSE_POSITIVE by scripts/backfill-prv-rejudge.ts; a human can reopen or re-rule it.`
}

export interface BackfillArgs {
  ruleRefs: string[]
  apply: boolean
}

/** `--rule <id>` (repeatable, required) and `--apply` (default: dry-run). */
export function parseBackfillArgs(argv: string[]): BackfillArgs {
  const ruleRefs: string[] = []
  let apply = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') {
      apply = true
      continue
    }
    if (a === '--rule') {
      const v = argv[i + 1]
      if (v == null || v.startsWith('--')) {
        throw new Error('--rule expects a policyRuleRef')
      }
      ruleRefs.push(v)
      i += 1
      continue
    }
    throw new Error(`unknown argument "${a ?? ''}"`)
  }
  if (ruleRefs.length === 0) {
    throw new Error('at least one --rule <policyRuleRef> is required')
  }
  return { ruleRefs: [...new Set(ruleRefs)], apply }
}
