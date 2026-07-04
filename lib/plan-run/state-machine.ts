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
