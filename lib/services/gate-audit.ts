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
   * source for an independent signal (github_check / github_status).
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
 * rows whose command classifies as a gate produce an event; pass/fail comes
 * from the event TYPE (the failure variant is the exit≠0 carrier), so the
 * read-model never has to trust a parsed exit code for the verdict — only for
 * display. Rows that match no gate, or carry no command, are dropped.
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
    const key = classifyCommand(command)
    if (!key) continue

    out.push({
      key,
      outcome: isSuccess ? 'success' : 'failure',
      command,
      exitCode: isSuccess ? 0 : failureExitCode(row.payload),
      hookEvent: row.type,
      at: row.createdAt.toISOString(),
      provenance: 'agent_self_reported',
    })
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
}

/**
 * Lift independent execution-gate signals out of GateSignal rows (the CI signal
 * Lumo derived from GitHub check-runs / commit-statuses — LUM-616). Rows whose
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
