/**
 * Gate-audit read-model (LUM-614). Derives a delivery's mechanical-gate audit
 * from normalized hook-event signals — a pure projection, no I/O, no storage.
 * The status of a gate is NEVER persisted; it is recomputed per delivery from
 * the HookEvent stream (same zero-schema derived-state route as the acceptance
 * verification state).
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
   * signal. Present only on passed/failed records.
   */
  pointer: string
  /** Raw HookEventType string the signal was lifted from. */
  hookEvent: string
  /** ISO timestamp of the producing event. */
  at: string
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
}

function latestEventByKey(
  events: readonly NormalizedGateEvent[]
): Map<GateKey, NormalizedGateEvent> {
  const latest = new Map<GateKey, NormalizedGateEvent>()
  for (const ev of events) {
    const prev = latest.get(ev.key)
    if (!prev || ev.at > prev.at) latest.set(ev.key, ev)
  }
  return latest
}

function recordFor(
  key: GateKey,
  configured: ReadonlySet<GateKey>,
  latest: Map<GateKey, NormalizedGateEvent>
): GateRecord {
  const provenance = provenanceForClass(gateDefinition(key).class)

  if (!configured.has(key)) {
    return { key, status: 'not_configured', provenance, grounding: null }
  }

  const ev = latest.get(key)
  if (!ev) {
    return { key, status: 'not_run', provenance, grounding: null }
  }

  return {
    key,
    status: ev.outcome === 'success' ? 'passed' : 'failed',
    provenance,
    grounding: {
      pointer: buildCmdEvidencePointer(ev.command, ev.exitCode),
      hookEvent: ev.hookEvent,
      at: ev.at,
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
  const latest = latestEventByKey(input.events)
  return { gates: universe.map(key => recordFor(key, configured, latest)) }
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
    })
  }
  return out
}

/**
 * Build a delivery's gate audit straight from its HookEvent rows. v1 wires the
 * execution gates only (read from the agent's own tool runs, self-reported);
 * detection gates (diff-scope / git-hygiene) have no independent server-side
 * derivation yet, so they stay not_configured until that follow-up lands —
 * honestly absent, never a fabricated pass.
 */
export function buildDeliveryGateAudit(
  rows: readonly GateHookEventRow[]
): DeliveryGateAudit {
  return deriveGateAudit({
    configured: EXECUTION_GATE_KEYS,
    events: normalizeHookEvents(rows),
  })
}
