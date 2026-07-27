import {
  effectiveReferentKind,
  type DeclarableReferentKind,
  type EffectiveReferentKind,
} from '../../shared/src/referent-kind'

/**
 * LUM-610 — fidelity axis, second block: the mechanical change-pattern
 * read-out. A PURE analysis over the LUM-609 delivery snapshot
 * (`TaskCriteriaSnapshot`) and the `CRITERION_CHANGED` audit trail. Zero new
 * storage; this module only reads what those two already record.
 *
 * It discloses two compositions per delivery and deliberately stops there —
 * NO single fidelity score, NO good/bad direction verdict (approach (a),
 * purely mechanical: timing + op + checkpointer grounding, never statement or
 * diff semantics):
 *
 *  1. grounding composition — `effectiveReferentKind` over the FROZEN contract,
 *     rolled into grounded / self-confirming / inconclusive with the full
 *     effective-kind tally kept alongside. `grounded` is a machine-checkable
 *     UPPER BOUND (the checkpointer heuristic can only over-count external
 *     grounding, never under-count it).
 *  2. independence signal — criteria in the delivered contract that were
 *     ADDED/UPDATED at round>0 (after work started) are "backward-inference"
 *     suspects: the contract was bent after the work began rather than fixed
 *     up front. round-0 (initial-draft) criteria are clean.
 *
 * The time anchor is the work-start boundary, so the caveat (carried on the
 * report) is explicit: this detects a contract edited AFTER work started, not
 * specifically after output was produced.
 */

/** Replay-sufficient shape of one frozen criterion (matches SnapshotCriterion). */
export interface SnapshotCriterionShape {
  id: string
  statement: string
  verifierType: string
  checkpointer: string | null
  referentKind: string | null
  evidenceRequired: boolean
}

/**
 * Coerce a stored `TaskCriteriaSnapshot.criteria` JSON value to the replay
 * shape, dropping malformed rows. The single parser every snapshot consumer
 * shares (fidelity show, milestone green quality) — same-source by import,
 * never by copy.
 */
export function parseSnapshotCriteria(raw: unknown): SnapshotCriterionShape[] {
  if (!Array.isArray(raw)) return []
  const out: SnapshotCriterionShape[] = []
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue
    const c = item as Record<string, unknown>
    if (typeof c.id !== 'string') continue
    out.push({
      id: c.id,
      statement: typeof c.statement === 'string' ? c.statement : '',
      verifierType: c.verifierType === 'HUMAN' ? 'HUMAN' : 'MACHINE',
      checkpointer: typeof c.checkpointer === 'string' ? c.checkpointer : null,
      referentKind: typeof c.referentKind === 'string' ? c.referentKind : null,
      evidenceRequired: c.evidenceRequired === true,
    })
  }
  return out
}

/** One CRITERION_CHANGED audit record, reduced to the mechanical fields. */
export interface CriterionChange {
  op: 'ADDED' | 'UPDATED' | 'DELETED'
  criterionId: string
  /** Verification round the edit was recorded at; 0 = initial draft. */
  round: number
  causeTag: string | null
  at: Date
}

/**
 * Coerce a stored `CRITERION_CHANGED` payload to {@link CriterionChange}, or
 * null when the row cannot be read mechanically.
 *
 * The single reader every consumer shares — same-source by import, never by
 * copy, for the same reason {@link parseSnapshotCriteria} is: "how to read a
 * CRITERION_CHANGED payload" is one decision (which ops count, what a missing
 * `round` defaults to), and a second copy of it drifts silently the first time
 * the payload gains a field. Payloads are freeform stored JSON that older code
 * paths also wrote, so every field is checked rather than trusted.
 */
export function criterionChangeFromPayload(
  raw: unknown,
  createdAt: Date
): CriterionChange | null {
  if (raw == null || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const op = p.op
  if (op !== 'ADDED' && op !== 'UPDATED' && op !== 'DELETED') return null
  if (typeof p.criterionId !== 'string') return null
  return {
    op,
    criterionId: p.criterionId,
    round: typeof p.round === 'number' ? p.round : 0,
    causeTag: typeof p.causeTag === 'string' ? p.causeTag : null,
    at: createdAt,
  }
}

/** One delivery (an append-only TaskCriteriaSnapshot row). */
export interface DeliverySnapshotInput {
  snapshotId: string
  frozenAt: Date
  trigger: string
  sessionId: string | null
  criteria: SnapshotCriterionShape[]
}

export interface GroundingComposition {
  /** EXTERNAL_FACT — anchored on a fact the agent cannot author. */
  grounded: number
  /** AGENT_CONSTRUCTED_STATE + UNVERIFIED_ASSERTION — passes on agent output. */
  selfConfirming: number
  /** PENDING_OUTCOME + UNCLASSIFIED — not mechanically resolvable here. */
  inconclusive: number
  /** Full per-kind tally — nothing rolled away. */
  byEffectiveKind: Record<EffectiveReferentKind, number>
}

export interface IndependenceSuspect {
  criterionId: string
  op: 'ADDED' | 'UPDATED'
  round: number
  causeTag: string | null
  /** ISO timestamp of the qualifying change. */
  at: string
}

export interface IndependenceSignal {
  /** Criteria in the frozen contract. */
  total: number
  /** Distinct contract criteria ADDED/UPDATED after work started (suspects). */
  postStartChanges: number
  suspects: IndependenceSuspect[]
}

export interface DeliveryFidelity {
  snapshotId: string
  frozenAt: string
  trigger: string
  sessionId: string | null
  total: number
  grounding: GroundingComposition
  independence: IndependenceSignal
}

export interface FidelityChangePatternReport {
  taskId: string
  workStartedAt: string | null
  /** Explicit so the no-snapshot case is never a silently-empty table. */
  hasSnapshots: boolean
  deliveries: DeliveryFidelity[]
  caveat: string
}

export const FIDELITY_CHANGE_PATTERN_CAVEAT =
  'Mechanical signals only — timing + op + checkpointer grounding, never statement or diff semantics. `grounded` is a machine-checkable UPPER BOUND (the checkpointer heuristic can over-count external grounding). The independence anchor is the work-start boundary: it detects a contract edited AFTER work started, not specifically after output was produced. No direction verdict is emitted.'

function emptyKindTally(): Record<EffectiveReferentKind, number> {
  return {
    EXTERNAL_FACT: 0,
    AGENT_CONSTRUCTED_STATE: 0,
    PENDING_OUTCOME: 0,
    UNVERIFIED_ASSERTION: 0,
    UNCLASSIFIED: 0,
  }
}

/**
 * Grounding composition of a frozen contract. Each criterion is classified by
 * the same `effectiveReferentKind` the acceptance gate uses (LUM-605), so a
 * declared-EXTERNAL_FACT criterion whose checkpointer doesn't truly ground
 * external is counted honestly as self-confirming (UNVERIFIED_ASSERTION), not
 * laundered into `grounded`.
 */
export function groundingComposition(
  criteria: SnapshotCriterionShape[]
): GroundingComposition {
  const byEffectiveKind = emptyKindTally()
  for (const c of criteria) {
    const eff = effectiveReferentKind({
      declared: (c.referentKind as DeclarableReferentKind | null) ?? null,
      verifierType: c.verifierType === 'HUMAN' ? 'HUMAN' : 'MACHINE',
      checkpointer: c.checkpointer,
    })
    byEffectiveKind[eff] += 1
  }
  return {
    grounded: byEffectiveKind.EXTERNAL_FACT,
    selfConfirming:
      byEffectiveKind.AGENT_CONSTRUCTED_STATE +
      byEffectiveKind.UNVERIFIED_ASSERTION,
    inconclusive:
      byEffectiveKind.PENDING_OUTCOME + byEffectiveKind.UNCLASSIFIED,
    byEffectiveKind,
  }
}

/**
 * Independence signal for one delivery. A criterion is a backward-inference
 * suspect when it is BOTH (a) in this delivery's frozen contract and (b) was
 * ADDED or UPDATED at round>0 at or before the freeze — i.e. the contract the
 * delivery rode on was bent after work began. round-0 criteria (set up front)
 * and DELETED ops (the delivery didn't ride on a removed criterion) never
 * count; changes recorded after the freeze belong to a later delivery cycle.
 *
 * Mechanical only: it surfaces op/round/causeTag and a count — it does NOT
 * decide whether a given edit was legitimate sharpening or tampering.
 */
export function independenceSignal(
  delivery: DeliverySnapshotInput,
  changes: CriterionChange[]
): IndependenceSignal {
  const contractIds = new Set(delivery.criteria.map(c => c.id))
  const frozenAtMs = delivery.frozenAt.getTime()
  const byCriterion = new Map<string, IndependenceSuspect>()

  for (const ch of changes) {
    if (ch.op !== 'ADDED' && ch.op !== 'UPDATED') continue
    if (ch.round <= 0) continue
    if (!contractIds.has(ch.criterionId)) continue
    if (ch.at.getTime() > frozenAtMs) continue

    const prior = byCriterion.get(ch.criterionId)
    if (prior && new Date(prior.at).getTime() >= ch.at.getTime()) continue
    byCriterion.set(ch.criterionId, {
      criterionId: ch.criterionId,
      op: ch.op,
      round: ch.round,
      causeTag: ch.causeTag,
      at: ch.at.toISOString(),
    })
  }

  const suspects = [...byCriterion.values()].sort((a, b) =>
    a.at < b.at
      ? -1
      : a.at > b.at
        ? 1
        : a.criterionId.localeCompare(b.criterionId)
  )
  return {
    total: delivery.criteria.length,
    postStartChanges: suspects.length,
    suspects,
  }
}

/** Assemble the per-delivery report. Deliveries are returned oldest-first. */
export function buildFidelityChangePatternReport(args: {
  taskId: string
  workStartedAt: Date | null
  deliveries: DeliverySnapshotInput[]
  changes: CriterionChange[]
}): FidelityChangePatternReport {
  const deliveries = [...args.deliveries]
    .sort((a, b) => a.frozenAt.getTime() - b.frozenAt.getTime())
    .map<DeliveryFidelity>(d => ({
      snapshotId: d.snapshotId,
      frozenAt: d.frozenAt.toISOString(),
      trigger: d.trigger,
      sessionId: d.sessionId,
      total: d.criteria.length,
      grounding: groundingComposition(d.criteria),
      independence: independenceSignal(d, args.changes),
    }))

  return {
    taskId: args.taskId,
    workStartedAt: args.workStartedAt ? args.workStartedAt.toISOString() : null,
    hasSnapshots: deliveries.length > 0,
    deliveries,
    caveat: FIDELITY_CHANGE_PATTERN_CAVEAT,
  }
}
