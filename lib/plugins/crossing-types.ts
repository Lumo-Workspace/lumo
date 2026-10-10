/**
 * LUM-1063 (RFC docs/rfc/2026-10-10-LUM-1058-plugin-boundary.md §2.2, §3.2,
 * §7 PR4) — the boundary-crossing extension points of the MIT core: extra
 * hook detectors, the system explanation of a crossing, and the source of a
 * project's compiled policy rules. Registered through
 * `PluginRegistrar.crossingDetector / crossingExplainer / policyRuleSource`
 * (`./types`), read through `./crossings`.
 *
 * Without a plugin the core runs its baseline detectors only (the RFC §2.2
 * left column), records the action classes (EXFILTRATION_PUBLIC,
 * CLOUD_DATA_DELETION, INFRA_TERMINATION, …) without the LLM prose
 * confirmation, has no compiled project rules (so no PROJECT_RULE_VIOLATION
 * and no project glob overrides), and answers a system-explanation request
 * with "not available".
 */
import type {
  BoundaryCrossingCategory,
  BoundaryCrossingSeverity,
} from '@prisma/client'
import type { PolicyRule } from '@/lib/policy/types'
import type { DetectedCrossing } from '@/lib/boundary-crossing/detection-types'

// ── crossing detectors ───────────────────────────────────────────────────────

/** One hook event as every detector sees it. */
export interface CrossingDetectionEvent {
  toolName: string | null
  filePath: string | null
  payload: unknown
  /** The Bash command (or an `apply_patch`'s synthetic `rm -- …`); null when
   *  the event carries none. Read once by the core. */
  command: string | null
}

/**
 * A command-shaped matcher. The core runs it exactly like its own: on the
 * executing segments of the command (or the raw command when `raw`), in the
 * literal pass and again on base64-decoded tokens (evasion → HIGH), and
 * builds the crossing (clipped detail, taxonomy severity, the matched
 * segment as the coalescing target).
 */
export interface CrossingCommandMatcher {
  category: BoundaryCrossingCategory
  fn: (cmd: string) => boolean
  /** Match against the raw command instead of its executing segments. */
  raw?: boolean
}

/** The judge a caller may hand to the confirmation step (tests, eval). */
export type CrossingConfirmJudge = (input: {
  command: string
  category: BoundaryCrossingCategory
}) => Promise<'REAL_ACTION' | 'PROSE_ONLY'>

export interface CrossingConfirmContext {
  /** The categories the installed command matchers find on `cmd` (literal
   *  pass only) — what a prose-stripped command still matches. */
  commandCategories(cmd: string): ReadonlySet<BoundaryCrossingCategory>
  /** Overrides the detector's own judge (tests, offline eval). */
  judge?: CrossingConfirmJudge
}

/**
 * A plugin's hook detector. The core pipeline runs, per event:
 *   1. every command matcher (core and plugin, in the core's category order)
 *      plus the evasion pass, then the hard-coded secret scan, then each
 *      detector's `detect`;
 *   2. each detector's `confirm` over the crossings of step 1 (e.g. drop a
 *      candidate that matched only as prose);
 *   3. with the project's policy rules loaded (`PolicyRuleSource`): the core
 *      sensitive-path edit check, then each detector's `detectWithRules`.
 * Every hook is pure or best-effort: a throw in `detect` /
 * `detectWithRules` drops only that detector's part of the event, a throw in
 * `confirm` keeps the crossings it was given. Detection never blocks the hook
 * (LUM-348 exit-0 invariant).
 */
export interface CrossingDetector {
  id: string
  /** The categories this detector can produce. */
  categories: readonly BoundaryCrossingCategory[]
  commandMatchers?: readonly CrossingCommandMatcher[]
  detect?(event: CrossingDetectionEvent): DetectedCrossing[]
  confirm?(
    event: CrossingDetectionEvent,
    crossings: DetectedCrossing[],
    ctx: CrossingConfirmContext
  ): Promise<DetectedCrossing[]>
  detectWithRules?(
    event: CrossingDetectionEvent,
    rules: readonly PolicyRule[]
  ): DetectedCrossing[]
}

// ── crossing explainer ───────────────────────────────────────────────────────

export interface CrossingExplainInput {
  /** The policy rule text the crossing quotes, if any. */
  rule: string | null
  /** The crossing's (redacted) detail. */
  evidence: string
  category: BoundaryCrossingCategory
  severity: BoundaryCrossingSeverity
  /** The agent's turn context around the event, when resolvable. */
  agentContext: string | null
}

/**
 * The SYSTEM plain-language explanation of a crossing (web panel, human
 * only, advisory). The first registered explainer answers; none → the core
 * refuses with 501 (not available on this server).
 */
export interface CrossingExplainer {
  id: string
  explain(input: CrossingExplainInput): Promise<{ explanation: string }>
}

// ── policy rule source ───────────────────────────────────────────────────────

/** Where a project's policy rules live: its default repository. */
export interface PolicyRuleProject {
  projectId: string
  workspaceId: string
}

/**
 * A project's compiled policy rules (CLAUDE.md / AGENTS.md). Rules are data
 * to the core: it applies their SENSITIVE_PATH_EDIT glob override itself and
 * hands them to the detectors' `detectWithRules`; it judges POLICY_WEAKENING
 * on rule TEXT (`lib/boundary-crossing/policy-weakening.ts`) and re-judges it
 * against the source this provider reads. No source → no rules, no project
 * detections, and a POLICY_WEAKENING re-judge that cannot read the source
 * decides nothing (UNDECIDABLE).
 */
export interface PolicyRuleSource {
  id: string
  /**
   * The rules the hook detector applies to an event of `taskId` — may
   * compile (and so call a model). Throws are caught by the core (no rules).
   */
  rulesForTask(
    input: PolicyRuleProject & { taskId: string }
  ): Promise<PolicyRule[]>
  /** The project's already-compiled rules; never compiles. Null = none. */
  storedRules(projectId: string): Promise<PolicyRule[] | null>
  /** A stored rule's text by its id, for rows written before the text was
   *  stamped on the crossing. */
  ruleTextByRef(projectId: string, ruleRef: string): Promise<string | null>
  /** The project's current CLAUDE.md + AGENTS.md text; null = unreadable. */
  readSource(
    input: PolicyRuleProject & { fullName: string }
  ): Promise<string | null>
}
