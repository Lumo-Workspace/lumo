/**
 * Gate-audit read-model (LUM-614 / LUM-616). Derives a delivery's mechanical-gate
 * audit from two normalized signal sources — agent-self-reported runs lifted from
 * HookEvent rows, and independent CI signals lifted from GateSignal rows — as a
 * pure projection, no I/O. A gate's status is recomputed per delivery; only the
 * raw GateSignal rows are stored (the audit verdict itself never is).
 *
 * Audit-only: this read-model reports whether a check *ran and passed*
 * mechanically. It is NOT a verdict on whether the work is correct — that
 * adjudication lives in the acceptance loop (VerificationRun). The two must
 * never be conflated, so the four-state vocabulary keeps "ran and passed"
 * strictly apart from "never ran" and "not even configured": a silent-absent
 * gate is never derived as passed.
 */

import { buildCmdEvidencePointer } from '../../shared/src/acceptance-evidence'
import {
  ALL_GATE_KEYS,
  GATE_DEFINITIONS,
  classifyCommand,
  gateDefinition,
  provenanceForClass,
  type GateKey,
  type GateProvenance,
} from '../../shared/src/gate-map'

export type GateStatus = 'passed' | 'failed' | 'not_run' | 'not_configured'

/**
 * Where an independent GateSignal row came from: a GitHub check-run or
 * commit status read back by the LUM-616 webhook path — the customer's own
 * CI. `lumo_sandbox` rows come from the LUM-746 managed CI, retired in
 * LUM-837 (Lumo no longer runs customers' tests or builds); no new ones are
 * written, but past rows still render. All three are `independent_harness`.
 */
export type GateSignalSource = 'github_check' | 'github_status' | 'lumo_sandbox'

export interface GateGrounding {
  /**
   * cmd:<command>#exit=<code> evidence pointer (shared acceptance-evidence
   * grammar) — a uniform, parseable, re-runnable handle on what produced the
   * signal. Present only on passed/failed records. For an independent CI signal
   * the "command" slot carries the CI check name.
   */
  pointer: string
  /**
   * The origin the signal was lifted from: a raw HookEventType for an
   * agent-self-reported run (POST_TOOL_USE / POST_TOOL_USE_FAILURE), or the CI
   * source for an independent signal (a GateSignalSource: github_check /
   * github_status / lumo_sandbox).
   */
  hookEvent: string
  /** ISO timestamp of the producing event. */
  at: string
  /** LUM-616: link to the producing CI run, present only on CI-sourced signals. */
  detailsUrl?: string
}

export interface GateRecord {
  key: GateKey
  status: GateStatus
  provenance: GateProvenance
  /** Bound to status: non-null iff status is passed/failed, else null. */
  grounding: GateGrounding | null
}

export interface DeliveryGateAudit {
  gates: GateRecord[]
}

/** A pull request a delivery's gate signals can be grouped under (LUM-617). */
export interface PrRef {
  number: number
  title: string
  state: string
  headBranch: string
  /**
   * LUM-623: the PR's delivery time (merge), used for temporal attribution of
   * self-reported signals a multi-PR task can't place by branch. ISO string, or
   * null for a still-open PR (its delivery window has no upper bound yet).
   * Optional/absent → no temporal window is inferred (fail-safe: such a signal
   * stays in the current branch/sole-PR/unlinked path).
   */
  mergedAt?: string | null
}

/** One PR's slice of the gate audit. */
export interface PrGateAudit {
  pr: PrRef
  audit: DeliveryGateAudit
}

/**
 * The delivery gate audit grouped by PR (LUM-617). Each known PR gets its own
 * gate set; signals that resolve to no PR land in `unlinked` (null when none) —
 * never dropped, never attributed to an arbitrary PR.
 */
export interface PerPrGateAudit {
  prs: PrGateAudit[]
  unlinked: DeliveryGateAudit | null
}

/**
 * A gate signal lifted out of a HookEvent row (classification + grounding
 * extraction happen upstream in the normalizer; this read-model consumes the
 * normalized shape so it stays a pure, fully-testable projection).
 */
export interface NormalizedGateEvent {
  key: GateKey
  outcome: 'success' | 'failure'
  command: string
  exitCode: number
  hookEvent: string
  at: string
  /**
   * LUM-616: how the signal was produced. Optional for backward compatibility —
   * a missing value is treated as the gate's class-default provenance. The
   * hook-event normalizer stamps `agent_self_reported`; the CI normalizer stamps
   * `independent_harness`.
   */
  provenance?: GateProvenance
  /** LUM-616: link to the producing CI run (CI-sourced events only). */
  detailsUrl?: string
  /**
   * LUM-617: the session a self-reported run ran in — used to attribute the
   * signal to a PR via the session's worktree branch. Null/absent for CI signals
   * (which carry `prNumber` directly).
   */
  sessionId?: string | null
  /**
   * LUM-617: the PR number this signal was recorded against (CI signals carry it
   * from the write-time linkage). Null/absent for self-reported signals, which
   * resolve their PR via `sessionId` → branch instead.
   */
  prNumber?: number | null
}

/**
 * Pick one event per gate with a trust-aware precedence: an independent CI
 * signal always wins over an agent-self-reported one for the same gate — even
 * if the self-report is newer — because the whole point is that the agent's word
 * must not override an independent fact. Within a single provenance bucket the
 * latest event (by timestamp) wins. A missing provenance counts as
 * self-reported (the legacy bucket).
 */
function chosenEventByKey(
  events: readonly NormalizedGateEvent[]
): Map<GateKey, NormalizedGateEvent> {
  const independent = new Map<GateKey, NormalizedGateEvent>()
  const selfReported = new Map<GateKey, NormalizedGateEvent>()
  for (const ev of events) {
    const bucket =
      ev.provenance === 'independent_harness' ? independent : selfReported
    const prev = bucket.get(ev.key)
    if (!prev || ev.at > prev.at) bucket.set(ev.key, ev)
  }
  const chosen = new Map<GateKey, NormalizedGateEvent>()
  for (const key of new Set([...independent.keys(), ...selfReported.keys()])) {
    const ev = independent.get(key) ?? selfReported.get(key)
    if (ev) chosen.set(key, ev)
  }
  return chosen
}

function recordFor(
  key: GateKey,
  configured: ReadonlySet<GateKey>,
  chosen: Map<GateKey, NormalizedGateEvent>
): GateRecord {
  const classProvenance = provenanceForClass(gateDefinition(key).class)

  if (!configured.has(key)) {
    return {
      key,
      status: 'not_configured',
      provenance: classProvenance,
      grounding: null,
    }
  }

  const ev = chosen.get(key)
  if (!ev) {
    return {
      key,
      status: 'not_run',
      provenance: classProvenance,
      grounding: null,
    }
  }

  return {
    key,
    status: ev.outcome === 'success' ? 'passed' : 'failed',
    // The chosen event's own provenance — so an execution gate carried by an
    // independent CI signal reports independent_harness, not its class default.
    provenance: ev.provenance ?? classProvenance,
    grounding: {
      pointer: buildCmdEvidencePointer(ev.command, ev.exitCode),
      hookEvent: ev.hookEvent,
      at: ev.at,
      ...(ev.detailsUrl ? { detailsUrl: ev.detailsUrl } : {}),
    },
  }
}

/**
 * Derive the delivery's gate audit. Every gate in `universe` (default: the
 * full static map) gets exactly one record:
 *   - not in `configured`           → not_configured
 *   - configured, no matching event → not_run
 *   - configured, latest success    → passed
 *   - configured, latest failure    → failed
 * Records are returned in `universe` order so the panel renders deterministically.
 */
export function deriveGateAudit(input: {
  universe?: readonly GateKey[]
  configured: readonly GateKey[]
  events: readonly NormalizedGateEvent[]
}): DeliveryGateAudit {
  const universe = input.universe ?? ALL_GATE_KEYS
  const configured = new Set(input.configured)
  const chosen = chosenEventByKey(input.events)
  return { gates: universe.map(key => recordFor(key, configured, chosen)) }
}

// ─── Normalization: HookEvent rows → NormalizedGateEvent ─────────────────────

/** Execution gates we read from the agent's own tool runs (self-reported). */
const EXECUTION_GATE_KEYS: readonly GateKey[] = GATE_DEFINITIONS.filter(
  d => d.class === 'execution'
).map(d => d.key)

/** A HookEvent row narrowed to the fields the gate normalizer reads. */
export interface GateHookEventRow {
  type: string
  payload: unknown
  createdAt: Date
  /** LUM-617: the session that produced this row (for PR attribution by branch). */
  sessionId?: string | null
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

/** Bash command lifted from a hook payload's tool_input, or null. */
function commandOf(payload: unknown): string | null {
  const input = getRecord(getRecord(payload)?.['tool_input'])
  const cmd = input?.['command']
  return typeof cmd === 'string' && cmd.trim() ? cmd : null
}

/** Non-zero exit code lifted from a failure payload's tool_response, else 1. */
function failureExitCode(payload: unknown): number {
  const resp = getRecord(getRecord(payload)?.['tool_response'])
  for (const field of ['exit_code', 'exitCode', 'code']) {
    const v = resp?.[field]
    if (typeof v === 'number' && v !== 0) return v
  }
  return 1
}

/**
 * Lift execution-gate signals out of HookEvent rows. Only Bash post-tool-use
 * rows whose command classifies as a gate produce events; pass/fail comes
 * from the event TYPE (the failure variant is the exit≠0 carrier), so the
 * read-model never has to trust a parsed exit code for the verdict — only for
 * display. Rows that match no gate, or carry no command, are dropped. A
 * command hitting several gates' invocation tokens (`npx jest …; npx tsc
 * --noEmit`) emits one event PER matched gate (LUM-629) — all sharing the
 * row's command/exit/timestamp grounding — instead of collapsing to a single
 * gate and under-reporting the rest as not_run.
 */
export function normalizeHookEvents(
  rows: readonly GateHookEventRow[]
): NormalizedGateEvent[] {
  const out: NormalizedGateEvent[] = []
  for (const row of rows) {
    const isSuccess = row.type === 'POST_TOOL_USE'
    const isFailure = row.type === 'POST_TOOL_USE_FAILURE'
    if (!isSuccess && !isFailure) continue

    const command = commandOf(row.payload)
    if (!command) continue

    for (const key of classifyCommand(command)) {
      out.push({
        key,
        outcome: isSuccess ? 'success' : 'failure',
        command,
        exitCode: isSuccess ? 0 : failureExitCode(row.payload),
        hookEvent: row.type,
        at: row.createdAt.toISOString(),
        provenance: 'agent_self_reported',
        sessionId: row.sessionId ?? null,
      })
    }
  }
  return out
}

// ─── Normalization: GateSignal rows → NormalizedGateEvent (LUM-616) ───────────

const EXECUTION_GATE_KEY_SET: ReadonlySet<string> = new Set(EXECUTION_GATE_KEYS)

/** True iff `key` names a known execution gate (typecheck/build/test). */
function isExecutionGateKey(key: string): key is GateKey {
  return EXECUTION_GATE_KEY_SET.has(key)
}

/**
 * A GateSignal row narrowed to the fields the CI normalizer reads. Decoupled
 * from Prisma (mirrors GateHookEventRow) so the read-model stays pure.
 */
export interface GateSignalRow {
  gateKey: string
  outcome: string
  checkName: string
  detailsUrl: string | null
  source: string
  createdAt: Date
  /** LUM-617: the PR this CI signal was recorded against (write-time linkage). */
  prNumber?: number | null
}

/**
 * Lift independent execution-gate signals out of GateSignal rows (the CI signal
 * Lumo derived from GitHub check-runs / commit-statuses — LUM-616 — plus
 * historical `lumo_sandbox` rows from the managed CI retired in LUM-837). Rows whose
 * gateKey is not a known execution gate are dropped (never coerced). Pass/fail
 * comes from the recorded outcome; the check name fills the grounding pointer's
 * command slot and the CI link rides along as detailsUrl.
 */
export function normalizeGateSignals(
  rows: readonly GateSignalRow[]
): NormalizedGateEvent[] {
  const out: NormalizedGateEvent[] = []
  for (const row of rows) {
    if (!isExecutionGateKey(row.gateKey)) continue
    const outcome = row.outcome === 'success' ? 'success' : 'failure'
    out.push({
      key: row.gateKey,
      outcome,
      command: row.checkName,
      exitCode: outcome === 'success' ? 0 : 1,
      hookEvent: row.source,
      at: row.createdAt.toISOString(),
      provenance: 'independent_harness',
      prNumber: row.prNumber ?? null,
      ...(row.detailsUrl ? { detailsUrl: row.detailsUrl } : {}),
    })
  }
  return out
}

/**
 * Build a delivery's gate audit from its two execution-gate signal sources:
 *   - agent-self-reported runs lifted from HookEvent rows (LUM-614), and
 *   - independent CI signals lifted from GateSignal rows (LUM-616).
 * An independent signal wins over a self-reported one for the same gate (see
 * chosenEventByKey). The detection gate (diff-scope) still has no
 * independent derivation wired (LUM-615), so they stay not_configured —
 * honestly absent, never a fabricated pass.
 */
export function buildDeliveryGateAudit(
  rows: readonly GateHookEventRow[],
  gateSignals: readonly GateSignalRow[] = []
): DeliveryGateAudit {
  return deriveGateAudit({
    configured: EXECUTION_GATE_KEYS,
    events: [
      ...normalizeHookEvents(rows),
      ...normalizeGateSignals(gateSignals),
    ],
  })
}

// ─── Per-PR grouping (LUM-617) ────────────────────────────────────────────────

/**
 * Resolve the PR a normalized event belongs to:
 *   - CI signals carry their PR number directly (write-time linkage), or
 *   - self-reported runs resolve via their session's worktree branch matching a
 *     PR's headBranch.
 * Returns null when neither path resolves — the caller buckets it as unlinked.
 */
function resolveEventPr(
  ev: NormalizedGateEvent,
  prByBranch: ReadonlyMap<string, number>,
  sessionBranchById: Readonly<Record<string, string | null>>
): number | null {
  if (ev.prNumber != null) return ev.prNumber
  if (ev.sessionId) {
    const branch = sessionBranchById[ev.sessionId]
    if (branch != null) return prByBranch.get(branch) ?? null
  }
  return null
}

/**
 * LUM-623: temporal attribution for a multi-PR task's self-reported signal that
 * no branch resolves. A single session delivers several PRs in sequence, so a
 * check run at time T fed the delivery it was building toward — the PR delivered
 * *next*: the one with the earliest `mergedAt` at or after T. A still-open PR
 * (mergedAt null) is the current in-flight delivery, chosen only when no merged
 * PR's window still contains T. Returns null when no PR's delivery lies at or
 * after T (every PR already shipped, none open) — the signal then stays
 * unlinked. Fail-safe by construction: it never attributes a signal to a PR that
 * had already merged before the signal ran, and never fabricates a window from a
 * PR whose `mergedAt` we don't know.
 */
function activePrAt(atIso: string, prs: readonly PrRef[]): number | null {
  const t = Date.parse(atIso)
  if (Number.isNaN(t)) return null
  let best: { number: number; deadline: number } | null = null
  for (const pr of prs) {
    // A merged PR's delivery deadline is its merge time; a still-open PR extends
    // to +∞ (its window has no upper bound yet). A PR with unknown mergedAt is
    // undefined here — skip it (no window to infer).
    let deadline: number
    if (pr.mergedAt === null) {
      deadline = Infinity
    } else if (typeof pr.mergedAt === 'string') {
      deadline = Date.parse(pr.mergedAt)
      if (Number.isNaN(deadline)) continue
    } else {
      continue // mergedAt absent → no temporal window
    }
    if (deadline < t) continue // already delivered before the signal — not it
    // Prefer the nearest upcoming delivery; ties → lowest PR number (stable).
    if (
      best === null ||
      deadline < best.deadline ||
      (deadline === best.deadline && pr.number < best.number)
    ) {
      best = { number: pr.number, deadline }
    }
  }
  return best?.number ?? null
}

/**
 * Build the delivery gate audit grouped by PR (LUM-617). Each known PR gets a
 * gate set derived only from the signals that resolve to it. An unresolved
 * signal attributes to the task's sole PR when there is exactly one (the only
 * candidate); for a multi-PR task it attributes by delivery window — the PR
 * delivered next at or after the signal's timestamp (LUM-623 `activePrAt`),
 * since a single session ships several PRs in sequence and its self-reported
 * checks feed the delivery they precede. Only a signal that still can't be
 * placed — naming a PR not on the task, or running after every delivery with
 * none open — collects in the explicit `unlinked` bucket (null when none), so a
 * stray signal is never silently dropped nor mis-attributed to an already-shipped
 * PR. Each group runs through the same `deriveGateAudit` projection, so the
 * four-state vocabulary and independent-over-self-reported precedence hold per
 * PR. Grouping-only: this never changes a gate's status, only which bucket it
 * lands in (audit-only red line, LUM-614).
 */
export function buildPerPrGateAudit(input: {
  hookRows: readonly GateHookEventRow[]
  gateSignals: readonly GateSignalRow[]
  pullRequests: readonly PrRef[]
  sessionBranchById: Readonly<Record<string, string | null>>
}): PerPrGateAudit {
  const events: NormalizedGateEvent[] = [
    ...normalizeHookEvents(input.hookRows),
    ...normalizeGateSignals(input.gateSignals),
  ]

  const prByBranch = new Map<string, number>()
  for (const pr of input.pullRequests) prByBranch.set(pr.headBranch, pr.number)
  const knownPr = new Set(input.pullRequests.map(p => p.number))
  // When the task has exactly one PR, an *unresolved* signal has a single
  // candidate — attribute it there rather than orphan it. This is not a guess
  // among many: with one PR it is the only delivery the signal could belong to.
  // A signal that *names* a PR not on the task keeps its identity and stays
  // unlinked (it is not reassigned to the sole PR).
  const solePr =
    input.pullRequests.length === 1 ? input.pullRequests[0]!.number : null

  const byPr = new Map<number, NormalizedGateEvent[]>()
  const unlinkedEvents: NormalizedGateEvent[] = []
  for (const ev of events) {
    const resolved = resolveEventPr(ev, prByBranch, input.sessionBranchById)
    // Attribution order: a signal that carries/resolves a *known* PR wins; one
    // naming a PR not on the task keeps its identity and stays unlinked; an
    // unresolved signal attributes to the sole PR when there is one, else — a
    // multi-PR task — falls to temporal attribution (LUM-623) by delivery window,
    // and only stays unlinked when even that can't place it.
    const target =
      resolved != null
        ? knownPr.has(resolved)
          ? resolved
          : null
        : (solePr ?? activePrAt(ev.at, input.pullRequests))
    if (target != null) {
      const arr = byPr.get(target)
      if (arr) arr.push(ev)
      else byPr.set(target, [ev])
    } else {
      unlinkedEvents.push(ev)
    }
  }

  const prs: PrGateAudit[] = [...input.pullRequests]
    .sort((a, b) => b.number - a.number)
    .map(pr => ({
      pr,
      audit: deriveGateAudit({
        configured: EXECUTION_GATE_KEYS,
        events: byPr.get(pr.number) ?? [],
      }),
    }))

  const unlinked =
    unlinkedEvents.length > 0
      ? deriveGateAudit({
          configured: EXECUTION_GATE_KEYS,
          events: unlinkedEvents,
        })
      : null

  return { prs, unlinked }
}
