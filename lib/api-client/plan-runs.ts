import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { PlanRunStage, PlanStageKind } from '@prisma/client'
import type { AlignVerdict } from '@/lib/plan-run/gate-b'
import type { ClusterGateOutput } from '@/lib/plan-run/cluster-gate'
import type {
  ConfirmAlignGateInput,
  ConfirmClusterGateInput,
  MaterializePlanInput,
} from '@/lib/validation/plan-run'
import type { GateCData, MaterializeResult } from '@/lib/services'

// ── Gate A (闸门A) — cluster board (LUM-669) ──────────────────────────────────

/** An idea as rendered on the gate-A board (statement + light origin). */
export interface ClusterGateIdea {
  id: string
  statement: string
  sourceContext: string | null
}

/** GET response for the gate-A board. */
export interface ClusterGateView {
  run: { id: string; stage: PlanRunStage }
  board: ClusterGateOutput
  revision: number
  confirmedAt: string | null
  ideas: ClusterGateIdea[]
}

/** POST response — the run after the gate advanced. */
export interface ConfirmClusterGateResponse {
  run: { id: string; stage: PlanRunStage }
}

// ── Gate B (闸门B) — align board (LUM-670) ────────────────────────────────────

/** One cluster card as rendered on the gate-B board (align LLM verdict). */
export interface AlignGateClusterView {
  clusterId: string
  verdict: AlignVerdict
  rationale: string
  customizationTrap: boolean
}

export interface AlignGateView {
  planRunId: string
  stage: string
  clusters: AlignGateClusterView[]
}

export interface ConfirmAlignGateResult {
  run: { id: string; stage: string }
  /** The clusterIds handed to Stage 3 (≤2 starred ALIGNED). */
  selectedClusterIds: string[]
}

// ── Plan-runs list + archive (LUM-677) ────────────────────────────────────────

/** A materialized Initiative referenced from a run (list + archive lineage). */
export interface PlanRunInitiativeRef {
  id: string
  number: number
  goalStatement: string
}

/** One row on the Ideas-page plan-runs surface: a run + its materialized
 *  Initiative(s). Newest-first, active + terminal. */
export interface PlanRunListRow {
  id: string
  stage: PlanRunStage
  createdAt: string
  updatedAt: string
  initiatives: PlanRunInitiativeRef[]
}

/** One gate's frozen record in the archive — the AI draft (`llmRawOutput`) and
 *  the human-confirmed edit (`humanConfirmedOutput`, null until confirmed). */
export interface PlanRunArchiveStage {
  kind: PlanStageKind
  model: string
  llmRawOutput: unknown
  humanConfirmedOutput: unknown
  confirmedBy: string | null
  confirmedAt: string | null
  revision: number
}

/** One cluster from the latest run's clustering — a label + its idea ids. */
export interface IdeaClusterGroup {
  name: string
  ideaIds: string[]
}

/** The clustering the Ideas page groups its pool by, or null when no run has
 *  clustered yet (the page then falls back to a flat list). */
export interface LatestClustering {
  runId: string
  clusters: IdeaClusterGroup[]
}

/** A run's full read-only archive: the run + every gate record + materialized
 *  Initiative(s) for lineage. */
export interface PlanRunArchive {
  id: string
  stage: PlanRunStage
  startedByMemberId: string
  prioritySnapshot: string | null
  createdAt: string
  updatedAt: string
  stageRecords: PlanRunArchiveStage[]
  initiatives: PlanRunInitiativeRef[]
}

// ── Gate dispatcher (LUM-671) ─────────────────────────────────────────────────

/** Thin run read for the gate dispatcher — which gate to render by stage. */
export interface PlanRunView {
  id: string
  stage: string
}

/**
 * Typed client for the design-thinking 转换器 (idea→plan converter) web gates.
 * The deep-link page picks the gate via `getRun`; gate A (闸门A · 聚类,
 * LUM-669) via `getClusterGate`/`confirmClusterGate`; gate B (闸门B · 对齐,
 * LUM-670) via `getAlignGate`/`confirmAlignGate`; gate C (闸门C · 物化,
 * LUM-671) via `getGateC`/`materialize`. No direct `fetch` in components.
 */
export const planRunsClient = {
  /** GET the caller team's plan runs (active + terminal), newest first. */
  list() {
    return apiFetch<{ runs: PlanRunListRow[] }>(API.planRuns.list)
  },

  /** GET a run's read-only archive (stage records + materialized initiatives). */
  getArchive(runId: string) {
    return apiFetch<PlanRunArchive>(API.planRuns.archive(runId))
  },

  /** GET the latest run's clustering (groups the Ideas page pool), or null. */
  latestClustering() {
    return apiFetch<{ clustering: LatestClustering | null }>(
      API.planRuns.latestClustering
    )
  },

  /** GET the run's current stage (gate dispatcher). */
  getRun(runId: string) {
    return apiFetch<PlanRunView>(API.planRuns.run(runId))
  },

  /** GET the gate-A cluster board for a run. */
  getClusterGate(runId: string) {
    return apiFetch<ClusterGateView>(API.planRuns.clusterGate(runId))
  },

  /** POST the reviewer's edited clustering to confirm gate A. */
  confirmClusterGate(runId: string, input: ConfirmClusterGateInput) {
    return apiFetch<ConfirmClusterGateResponse>(
      API.planRuns.clusterGate(runId),
      { method: 'POST', body: input }
    )
  },

  /** GET the gate-B align board for a run. */
  getAlignGate(runId: string) {
    return apiFetch<AlignGateView>(API.planRuns.alignGate(runId))
  },

  /** POST the human's confirmed verdicts to confirm gate B. */
  confirmAlignGate(runId: string, input: ConfirmAlignGateInput) {
    return apiFetch<ConfirmAlignGateResult>(API.planRuns.alignGate(runId), {
      method: 'POST',
      body: input,
    })
  },

  /** GET the Gate-C render data for a DRAFT_READY run. */
  getGateC(runId: string) {
    return apiFetch<GateCData>(API.planRuns.materializeGate(runId))
  },

  /** POST the confirmed plan to materialise it. */
  materialize(runId: string, input: MaterializePlanInput) {
    return apiFetch<MaterializeResult>(API.planRuns.materializeGate(runId), {
      method: 'POST',
      body: input,
    })
  },
}
