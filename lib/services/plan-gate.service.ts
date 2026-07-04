import type { Prisma } from '@prisma/client'
import {
  planRunRepository,
  type PlanRunRow,
} from '@/lib/repositories/plan-run.repository'
import { planRunService } from '@/lib/services/plan-run.service'
import { ALIGN_GATE_STAGE, selectStarredAligned } from '@/lib/plan-run/gate-b'
import type {
  ConfirmedAlignCluster,
  AlignGateConfirmedOutput,
} from '@/lib/plan-run/gate-b'
import type { ConfirmAlignGateInput } from '@/lib/validation/plan-run'
// Type-only — erased at runtime, so this never loads the align client's `ai`
// static imports (TransformStream jest trap).
import type {
  PlanAlignResult,
  PlanAlignClusterVerdict,
} from '@/lib/llm/plan-align-client'

/**
 * Gate B (闸门B · 对齐确认) service (LUM-670, Spec2-8). The web board opens on an
 * ALIGNMENT_READY run: each cluster shows the LLM's three-way verdict, its
 * customization-trap flag and a one-line rationale. The human switches
 * verdicts, edits rationales and stars ≤2 ALIGNED clusters; confirming freezes
 * that judgment onto the ALIGN stage record's `humanConfirmedOutput`, advances
 * the run to GENERATING, and hands the ≤2 starred ALIGNED clusters to Stage 3.
 *
 * Reads only the ALIGN stage record — it is authoritative for which clusters
 * exist and each one's `customizationTrap`. It does NOT invoke the Stage-3
 * generation LLM (its theme/ideas input isn't wired until the orchestrator
 * lands); "trigger Stage3" here means entering Stage3's working stage with the
 * selection recorded. No Prisma, no HTTP — errors carry `{ status }`.
 */

export interface AlignGateCluster {
  clusterId: string
  verdict: PlanAlignClusterVerdict['verdict']
  rationale: string
  customizationTrap: boolean
}

export interface AlignGateView {
  planRunId: string
  stage: PlanRunRow['stage']
  clusters: AlignGateCluster[]
}

export interface ConfirmAlignGateResult {
  run: PlanRunRow
  /** The clusterIds actually handed to Stage 3 (≤2 starred ALIGNED). */
  selectedClusterIds: string[]
}

function badRequest(message: string, status: number): never {
  throw Object.assign(new Error(message), { status })
}

/** Read the frozen ALIGN LLM output for a gate that must be open right now. */
async function loadOpenAlignGate(
  planRunId: string
): Promise<{ run: PlanRunRow; aligned: PlanAlignResult }> {
  const run = await planRunService.requireRun(planRunId)
  if (run.stage !== ALIGN_GATE_STAGE) {
    badRequest(
      `Plan run ${run.id} is at stage ${run.stage}; the align gate is only open at ${ALIGN_GATE_STAGE}`,
      409
    )
  }
  const record = await planRunRepository.findStageRecord(run.id, 'ALIGN')
  if (!record) {
    badRequest(`Plan run ${run.id} has no ALIGN stage output to confirm`, 409)
  }
  return { run, aligned: record.llmRawOutput as unknown as PlanAlignResult }
}

export const planGateService = {
  /**
   * Render source for the gate-B board: the ALIGN LLM verdicts, one per
   * cluster. 409 unless the run is parked at ALIGNMENT_READY with an ALIGN
   * record. 404 if the run is missing.
   */
  async getAlignGate(planRunId: string): Promise<AlignGateView> {
    const { run, aligned } = await loadOpenAlignGate(planRunId)
    return {
      planRunId: run.id,
      stage: run.stage,
      clusters: aligned.clusters.map(c => ({
        clusterId: c.clusterId,
        verdict: c.verdict,
        rationale: c.rationale,
        customizationTrap: c.customizationTrap,
      })),
    }
  },

  /**
   * Confirm gate B: freeze the human's verdict switches + star selections onto
   * the ALIGN record, advance ALIGNMENT_READY → GENERATING, and report the ≤2
   * starred ALIGNED clusters passed to Stage 3.
   *
   * The submitted clusterIds must cover the ALIGN record's cluster set exactly
   * (full-set replace) — an unknown or missing clusterId is a 422, so a stale
   * board can't silently drop or invent a cluster. `customizationTrap` is taken
   * from the record, never the request. (The ≤2-star and star-only-on-ALIGNED
   * rules are already enforced by `confirmAlignGateSchema` at the route.)
   */
  async confirmAlignGate(args: {
    planRunId: string
    memberId: string
    input: ConfirmAlignGateInput
  }): Promise<ConfirmAlignGateResult> {
    const { run, aligned } = await loadOpenAlignGate(args.planRunId)

    const trapById = new Map(
      aligned.clusters.map(c => [c.clusterId, c.customizationTrap])
    )
    const submittedIds = new Set(args.input.clusters.map(c => c.clusterId))

    if (submittedIds.size !== args.input.clusters.length) {
      badRequest('Duplicate clusterId in gate-B confirmation', 422)
    }
    for (const c of args.input.clusters) {
      if (!trapById.has(c.clusterId)) {
        badRequest(
          `Unknown clusterId "${c.clusterId}" — not part of run ${run.id}'s alignment`,
          422
        )
      }
    }
    if (submittedIds.size !== trapById.size) {
      badRequest(
        `Gate-B confirmation must cover all ${trapById.size} aligned clusters (got ${submittedIds.size})`,
        422
      )
    }

    const clusters: ConfirmedAlignCluster[] = args.input.clusters.map(c => ({
      clusterId: c.clusterId,
      verdict: c.verdict,
      starred: c.starred,
      rationale: c.rationale,
      // Server-authoritative: the trap flag can't be edited away at the gate.
      customizationTrap: trapById.get(c.clusterId) ?? false,
    }))

    const humanConfirmedOutput: AlignGateConfirmedOutput = { clusters }

    const updatedRun = await planRunService.confirmGate({
      planRunId: run.id,
      humanConfirmedOutput:
        humanConfirmedOutput as unknown as Prisma.InputJsonValue,
      confirmedBy: args.memberId,
    })

    return {
      run: updatedRun,
      selectedClusterIds: selectStarredAligned(clusters).map(c => c.clusterId),
    }
  },
}
