/**
 * LUM-1063 — the security plugin's boundary-crossing detectors (RFC
 * docs/rfc/2026-10-10-LUM-1058-plugin-boundary.md §2.2, right column),
 * registered on the core detection pipeline by `./server.ts`:
 *
 *   - `advancedCommandDetector`: DESTRUCTIVE_FS_COMMAND (LUM-960) and
 *     UNTRUSTED_CODE_EXECUTION (LUM-962) command matchers, SENSITIVE_PATH_READ
 *     on the built-in credential stores (LUM-963), and the LUM-466 LLM
 *     confirmation of action-category candidates that matched only as prose;
 *   - `policyRuleDetector`: the project's compiled rules (LUM-590) —
 *     PROJECT_RULE_VIOLATION from action predicates (cmd-substr / push-target
 *     / path-delete, LUM-751 / LUM-772 / LUM-1236) and SENSITIVE_PATH_READ from the project's read globs.
 *
 * The code moved here verbatim from `lib/services/boundary-detector.service.ts`;
 * the core keeps the pipeline (reading the event, evasion pass, clipping,
 * coalescing, recording) and its baseline detectors. Synchronous parts are
 * pure; only the confirmation calls a model, lazily imported.
 */
import { createHash } from 'crypto'
import type { BoundaryCrossingCategory } from '@prisma/client'
import type { PolicyRule } from '@/lib/policy/types'
import type { DetectedCrossing } from '@/lib/boundary-crossing/detection-types'
import type {
  CrossingConfirmContext,
  CrossingDetectionEvent,
  CrossingDetector,
} from '@/lib/plugins/crossing-types'
import { clip } from '@/lib/boundary-crossing/detection-input'
import { severityFor } from '@/lib/boundary-crossing/taxonomy'
import { isEvasionDecoded } from '@/lib/boundary-crossing/evasion'
import { sensitiveReadRulesFromRules } from '@/lib/boundary-crossing/policy-rule-paths'
import {
  confirmActionCrossing,
  isActionConfirmCategory,
  stripProse,
  type ActionConfirmInput,
  type ActionConfirmJudge,
  type ActionConfirmVerdict,
} from '@/ee/security/boundary-crossing/action-confirm'
import { matchUntrustedCodeExecution } from '@/ee/security/boundary-crossing/untrusted-code'
import { matchDestructiveFs } from '@/ee/security/boundary-crossing/destructive-fs'
import {
  detectProjectSensitiveReads,
  detectSensitiveReads,
  type SensitiveReadMatch,
} from '@/ee/security/boundary-crossing/sensitive-read'
import { matchActionRule } from '@/ee/security/boundary-crossing/action-rule-match'
import { matchPushTarget } from '@/ee/security/boundary-crossing/push-target-match'
import {
  matchPathDelete,
  parsePathDeleteValue,
  pathsCoveredByMigrationBuiltin,
} from '@/lib/boundary-crossing/path-delete'
// NOTE: the LLM client (`@/lib/llm/action-confirm-client`) is loaded LAZILY
// inside its cached wrapper — it pulls in the heavy `ai` / `@ai-sdk/gateway`
// SDK, and a static import would drag that into every module that loads the
// plugin registry (and every test of it).

// --- LUM-963: sensitive reads -------------------------------------------------

/** One sensitive read → its crossing. Always LOW + advisory, whether the
 *  built-in list or a project rule made the path sensitive (LUM-963). */
function sensitiveReadCrossing(r: SensitiveReadMatch): DetectedCrossing {
  return {
    category: 'SENSITIVE_PATH_READ',
    detail: clip(
      `read sensitive path ${r.path} (${r.label}) via ${r.via} — advisory${
        r.alsoRead?.length
          ? ` — +${r.alsoRead.length} more in this command: ${r.alsoRead.join(', ')}`
          : ''
      }`
    ),
    severity: severityFor('SENSITIVE_PATH_READ'),
    target: r.path,
    advisory: true,
    ...(r.ruleId != null ? { policyRuleRef: r.ruleId } : {}),
    ...(r.ruleText != null ? { policyRuleText: r.ruleText } : {}),
  }
}

/**
 * The reads a project rule adds for one event (built-in reads come from the
 * advanced detector's `detect`). Pure.
 */
export function detectProjectSensitiveReadCrossings(
  event: CrossingDetectionEvent,
  rules: readonly PolicyRule[]
): DetectedCrossing[] {
  return detectProjectSensitiveReads(
    {
      toolName: event.toolName,
      filePath: event.filePath,
      command: event.command,
    },
    sensitiveReadRulesFromRules([...rules])
  ).map(sensitiveReadCrossing)
}

// --- LUM-466: action-category prose-vs-real confirmation ----------------------
//
// The deterministic command matchers are high-recall and also trip on a
// forbidden token that appears only as PROSE — inside a commit message, a PR
// body, an echo string. For each action-category candidate we re-run the
// matchers on a prose-stripped copy of the command: a category that STILL
// matches outside all quotes/heredocs is a real executed action (certain → flag,
// no LLM call); one that vanished matched only prose and is handed to the
// best-effort LLM confirmation, which suppresses it ONLY on a clear PROSE_ONLY
// verdict. Conservative + observe-only throughout (criteria 2/3).

// Process-level cache so an identical (category, command) is confirmed once.
// Failures are NOT cached, so a transient gateway error re-tries on the next hit.
const actionConfirmCache = new Map<string, Promise<ActionConfirmVerdict>>()
const ACTION_CONFIRM_CACHE_MAX = 500

function actionConfirmCacheKey(input: ActionConfirmInput): string {
  return createHash('sha256')
    .update(`${input.category}\n${input.command}`)
    .digest('hex')
}

function cachedActionConfirm(
  input: ActionConfirmInput
): Promise<ActionConfirmVerdict> {
  const key = actionConfirmCacheKey(input)
  const hit = actionConfirmCache.get(key)
  if (hit) return hit
  // Lazy import: pay the SDK load only when the model is actually consulted.
  const p = import('@/ee/security/llm/action-confirm-client').then(mod =>
    mod.confirmActionExecuted(input)
  )
  actionConfirmCache.set(key, p)
  p.catch(() => actionConfirmCache.delete(key))
  if (actionConfirmCache.size > ACTION_CONFIRM_CACHE_MAX) {
    const oldest = actionConfirmCache.keys().next().value
    if (oldest !== undefined) actionConfirmCache.delete(oldest)
  }
  return p
}

/**
 * Confirm the action-category candidates in `crossings` against the command:
 * keep every non-action crossing untouched; keep an action crossing that still
 * matches on the prose-stripped command (a real, deterministically-certain
 * action — NO LLM call); for one that matched ONLY inside prose, ask the
 * best-effort LLM and DROP it only on a clear PROSE_ONLY verdict (REAL_ACTION /
 * uncertain / failure keeps it). Defensive throughout — any error keeps the base
 * (flagged) crossing, so a candidate is never silently lost (criteria 2/3).
 */
export async function confirmActionCandidates(
  event: CrossingDetectionEvent,
  crossings: DetectedCrossing[],
  ctx: CrossingConfirmContext
): Promise<DetectedCrossing[]> {
  const cmd = event.command
  const judge: ActionConfirmJudge = ctx.judge ?? cachedActionConfirm
  // Without a command string there is no prose to strip and nothing to confirm
  // (a Write's HARDCODED_SECRET, etc.) — pass the crossings through untouched.
  if (!cmd) return crossings
  // Stage 1: which categories still match OUTSIDE all prose? Those are real,
  // deterministically-certain actions and never reach the LLM.
  let certain: ReadonlySet<BoundaryCrossingCategory>
  try {
    certain = ctx.commandCategories(stripProse(cmd))
  } catch {
    // If de-prose itself fails, keep every flag (the conservative direction).
    return crossings
  }
  const out: DetectedCrossing[] = []
  for (const c of crossings) {
    if (!isActionConfirmCategory(c.category)) {
      out.push(c) // HARDCODED_SECRET / NEW_NPM_DEPENDENCY
      continue
    }
    // Evasion-decoded crossings (base64) are deliberate obfuscation, already
    // HIGH — never let the LLM suppress one (the high-severity red line).
    if (isEvasionDecoded(c.detail)) {
      out.push(c)
      continue
    }
    if (certain.has(c.category)) {
      out.push(c) // matched outside prose → a real action, flagged without the LLM
      continue
    }
    // Prose candidate → best-effort confirmation. Suppress only on PROSE_ONLY;
    // REAL_ACTION / uncertain / failure keeps the candidate flagged.
    let verdict: ActionConfirmVerdict
    try {
      verdict = await confirmActionCrossing(
        { command: cmd, category: c.category },
        { judge }
      )
    } catch {
      verdict = 'REAL_ACTION'
    }
    if (verdict === 'PROSE_ONLY') continue
    out.push(c)
  }
  return out
}

// --- LUM-590: project action-rule predicates ----------------------------------

/**
 * LUM-1236: a `path-delete` rule mapped to MIGRATION_FILE_DELETED whose paths
 * all lie under prisma/migrations is judged by the built-in detector alone —
 * it reads the same deletes (lib/boundary-crossing/path-delete), so one real
 * deletion is one crossing and one ruling, not two. Pure.
 */
export function isCoveredByBuiltinDetector(rule: PolicyRule): boolean {
  return (
    rule.mappedCategory === 'MIGRATION_FILE_DELETED' &&
    rule.predicate?.type === 'path-delete' &&
    pathsCoveredByMigrationBuiltin(parsePathDeleteValue(rule.predicate.value))
  )
}

/**
 * Test a set of compiled PolicyRules against a hook event's command and return
 * any crossings (LUM-590). Only deterministic action rules with a cmd-substr /
 * push-target predicate are handled here — path-glob action predicates are
 * handled by the code pipeline. Pure.
 *
 * v1 semantics: a project-specific predicate (blocking === false) produces an
 * ADVISORY crossing; a mapped built-in (blocking === true) would produce a
 * standard crossing, but in practice blocking rules always go through the
 * built-in matchers.
 */
export function detectProjectActionCrossings(
  event: CrossingDetectionEvent,
  rules: readonly PolicyRule[]
): DetectedCrossing[] {
  const command = event.command
  if (!command) return []
  const out: DetectedCrossing[] = []
  for (const r of rules) {
    if (r.kind !== 'action' || r.tier !== 'deterministic' || !r.predicate)
      continue
    const p = r.predicate
    // path-glob action predicates are handled by the code pipeline — skip here.
    // LUM-751: segment-scoped + prose-stripped (lib/boundary-crossing/
    // action-rule-match) — a read-only / PR-target reference or a quoted
    // keyword no longer counts as a violation.
    // LUM-772: a push prohibition compiles to `push-target` and is judged on
    // the push's OWN destination (a feature push next to `gh pr create --base
    // main` is not a push to main).
    // LUM-1236: a "never delete files in <path>" rule compiles to
    // `path-delete` and is judged on the operands of the delete itself.
    if (isCoveredByBuiltinDetector(r)) continue
    const hit =
      p.type === 'cmd-substr'
        ? matchActionRule(p.value, command)
        : p.type === 'push-target'
          ? matchPushTarget(p.value, command)
          : p.type === 'path-delete'
            ? matchPathDelete(p.value, command)
            : false
    if (!hit) continue
    out.push({
      category: 'PROJECT_RULE_VIOLATION',
      detail: clip(command),
      severity: r.severity,
      target: `actionrule:${r.id}`,
      advisory: !r.blocking,
      policyRuleRef: r.id,
      policyRuleText: r.text,
    })
  }
  return out
}

// --- the registered detectors -------------------------------------------------

export const advancedCommandDetector: CrossingDetector = {
  id: 'security.advanced',
  categories: [
    'DESTRUCTIVE_FS_COMMAND',
    'UNTRUSTED_CODE_EXECUTION',
    'SENSITIVE_PATH_READ',
  ],
  commandMatchers: [
    // LUM-960: rm -rf / find -delete on a root-level path, shred, mkfs, dd of=/dev.
    { category: 'DESTRUCTIVE_FS_COMMAND', fn: matchDestructiveFs },
    // LUM-962: reads the RAW command — the `|` between a downloader and an
    // interpreter is the signal, and the executing-segment view has cut it.
    // Carriers are excluded inside the matcher itself.
    {
      category: 'UNTRUSTED_CODE_EXECUTION',
      fn: matchUntrustedCodeExecution,
      raw: true,
    },
  ],
  // LUM-963: reading a credential store outside the repo (Read tool, or a
  // Bash segment whose verb reads its operands). Recorded LOW + advisory —
  // agents read config constantly, so this is a hint and never blocks DONE.
  // Coalesces per normalized path.
  detect(event) {
    return detectSensitiveReads({
      toolName: event.toolName,
      filePath: event.filePath,
      command: event.command,
    }).map(sensitiveReadCrossing)
  },
  // LUM-466: drop a forbidden token that matched only as prose (commit
  // message / PR body / echo), keep real executed actions and anything the
  // best-effort LLM can't clear.
  confirm: confirmActionCandidates,
}

export const policyRuleDetector: CrossingDetector = {
  id: 'security.policy-rules',
  categories: ['PROJECT_RULE_VIOLATION', 'SENSITIVE_PATH_READ'],
  detectWithRules(event, rules) {
    return [
      ...detectProjectActionCrossings(event, rules),
      // LUM-963: the project's own sensitive-read paths (advisory, additive).
      ...detectProjectSensitiveReadCrossings(event, rules),
    ]
  },
}
