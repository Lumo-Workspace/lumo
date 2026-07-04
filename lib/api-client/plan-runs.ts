import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { AlignVerdict } from '@/lib/plan-run/gate-b'
import type {
  ConfirmAlignGateInput,
  MaterializePlanInput,
} from '@/lib/validation/plan-run'
import type { GateCData, MaterializeResult } from '@/lib/services'

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

/** Thin run read for the gate dispatcher — which gate to render by stage. */
export interface PlanRunView {
  id: string
  stage: string
}

/**
 * Typed client for the design-thinking 转换器 gates. The web boards read/confirm
 * through here — no direct `fetch` in components. Gate B (闸门B · 对齐,
 * LUM-670) via `getAlignGate`/`confirmAlignGate`; Gate C (闸门C · 物化, LUM-671)
 * via `getGateC`/`materialize`; the deep-link page picks the gate via `getRun`.
 */
export const planRunsClient = {
  /** GET the run's current stage (gate dispatcher). */
  getRun(runId: string) {
    return apiFetch<PlanRunView>(API.planRuns.run(runId))
  },

  getAlignGate(runId: string) {
    return apiFetch<AlignGateView>(API.planRuns.alignGate(runId))
  },

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
