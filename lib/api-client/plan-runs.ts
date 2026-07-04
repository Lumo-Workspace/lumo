import { apiFetch } from './base'
import { API } from '@/app/workspace/[workspaceUrl]/constants'
import type { AlignVerdict } from '@/lib/plan-run/gate-b'
import type { ConfirmAlignGateInput } from '@/lib/validation/plan-run'

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

/**
 * Typed client for the design-thinking 转换器 gate B (闸门B). The board reads the
 * align verdicts via `getAlignGate` and submits the human's confirmed judgment
 * via `confirmAlignGate` — no direct `fetch` in components.
 */
export const planRunsClient = {
  getAlignGate(runId: string) {
    return apiFetch<AlignGateView>(API.planRuns.alignGate(runId))
  },

  confirmAlignGate(runId: string, input: ConfirmAlignGateInput) {
    return apiFetch<ConfirmAlignGateResult>(API.planRuns.alignGate(runId), {
      method: 'POST',
      body: input,
    })
  },
}
