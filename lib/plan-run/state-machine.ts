import type { PlanRunStage, PlanStageKind } from '@prisma/client'

// ── Converter state machine (LUM-664, Spec2-2) ───────────────────────────────
// The design-thinking 转换器 is a per-team, recoverable 3-gate state machine.
// Each of the three gates (CLUSTER → ALIGN → GENERATE) has two edges:
//
//   working ──segment complete──▶ *_READY ──gate confirm──▶ next working
//
//   CLUSTERING  ──CLUSTER──▶  CLUSTERS_READY  ──confirm──▶  ALIGNING
//   ALIGNING    ──ALIGN────▶  ALIGNMENT_READY ──confirm──▶  GENERATING
//   GENERATING  ──GENERATE─▶  DRAFT_READY     ──confirm──▶  MATERIALIZED
//
// ABANDONED / MATERIALIZED are the terminal stages (the run lock treats only
// these two as "not active"). FAILED is a recoverable stage: a failed segment
// is retried, which overwrites its stage record and re-enters the *_READY gate.

/** Terminal stages — a run in one of these is no longer active (run lock). */
export const TERMINAL_STAGES: readonly PlanRunStage[] = [
  'MATERIALIZED',
  'ABANDONED',
]

/**
 * Segment edges: recording a stage's LLM output advances the run from its
 * working stage to the matching `*_READY` gate. A retry after FAILED targets
 * the same `ready` stage, which is why FAILED is not itself a `from` — the
 * caller names the kind being (re)run and we route to its ready stage.
 */
export const SEGMENT_BY_KIND: Record<
  PlanStageKind,
  { working: PlanRunStage; ready: PlanRunStage }
> = {
  CLUSTER: { working: 'CLUSTERING', ready: 'CLUSTERS_READY' },
  ALIGN: { working: 'ALIGNING', ready: 'ALIGNMENT_READY' },
  GENERATE: { working: 'GENERATING', ready: 'DRAFT_READY' },
}

/**
 * Gate edges: confirming a `*_READY` gate persists the human-confirmed output
 * on that kind's stage record and advances the run to the next stage. A stage
 * that is not a gate maps to `undefined` — confirming there is illegal.
 */
const GATE_BY_STAGE: Partial<
  Record<PlanRunStage, { kind: PlanStageKind; next: PlanRunStage }>
> = {
  CLUSTERS_READY: { kind: 'CLUSTER', next: 'ALIGNING' },
  ALIGNMENT_READY: { kind: 'ALIGN', next: 'GENERATING' },
  DRAFT_READY: { kind: 'GENERATE', next: 'MATERIALIZED' },
}

/** The gate open at `stage`, or `undefined` if the stage is not a gate. */
export function gateAt(
  stage: PlanRunStage
): { kind: PlanStageKind; next: PlanRunStage } | undefined {
  return GATE_BY_STAGE[stage]
}

/** True when `stage` is terminal (MATERIALIZED / ABANDONED) → run not active. */
export function isTerminalStage(stage: PlanRunStage): boolean {
  return TERMINAL_STAGES.includes(stage)
}

// ── Retry (LUM-689) ──────────────────────────────────────────────────────────

/** The working stage of each segment, keyed for the reverse lookup below. */
const KIND_BY_WORKING_STAGE: Partial<Record<PlanRunStage, PlanStageKind>> = {
  CLUSTERING: 'CLUSTER',
  ALIGNING: 'ALIGN',
  GENERATING: 'GENERATE',
}

/**
 * Which segment a stuck run should re-run, or `null` when there is nothing to
 * retry.
 *
 * A run wedges in two shapes, and both are recoverable by re-running exactly
 * one segment:
 *
 * - **A working stage** — its runner never ran, died before recording, or was
 *   never wired at all (every gate-B-confirmed run sat in GENERATING until
 *   LUM-689). The stage itself names the segment.
 * - **FAILED** — a runner caught and marked the run failed. FAILED overwrites
 *   the stage, so the segment is recovered from the stage records instead: the
 *   first kind in pipeline order that has not produced a record yet is the one
 *   that failed. A kind whose record exists but is unconfirmed means the run
 *   failed *at a gate*, which is not a segment to re-run.
 *
 * A run parked at an open gate or in a terminal stage returns `null` — the
 * caller is expected to reject it rather than silently re-running work.
 */
export function retryableKind(args: {
  stage: PlanRunStage
  /** Stage records that exist, with whether each has been gate-confirmed. */
  records: ReadonlyArray<{ kind: PlanStageKind; confirmed: boolean }>
}): PlanStageKind | null {
  const working = KIND_BY_WORKING_STAGE[args.stage]
  if (working) return working
  if (args.stage !== 'FAILED') return null

  const byKind = new Map(args.records.map(r => [r.kind, r.confirmed]))
  // Pipeline order: the first segment with no record is where the run stopped.
  for (const kind of ['CLUSTER', 'ALIGN', 'GENERATE'] as const) {
    const confirmed = byKind.get(kind)
    if (confirmed === undefined) return kind
    // Record exists but was never confirmed → the run failed sitting at that
    // gate, not inside a segment. Re-running would discard a human's pending
    // review, so there is nothing to retry.
    if (!confirmed) return null
  }
  return null
}
