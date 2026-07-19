import type { Prisma } from '@prisma/client'
import {
  planRunRepository,
  type PlanRunRow,
} from '@/lib/repositories/plan-run.repository'
import { planRunService } from '@/lib/services/plan-run.service'
import { ideaRepository } from '@/lib/repositories/idea.repository'
import {
  clusterIndexFromId,
  collectClusterGateIds,
  type ClusterGateCluster,
  type ClusterGateOutput,
} from '@/lib/plan-run/cluster-gate'
import {
  ALIGN_GATE_STAGE,
  clusterIdeaUniverse,
  resolveKeptIdeaIds,
  selectStarredAligned,
} from '@/lib/plan-run/gate-b'
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

/** One idea inside a gate-B cluster card — enough to recognise it, no more. */
export interface AlignGateIdea {
  id: string
  statement: string
}

export interface AlignGateCluster {
  clusterId: string
  verdict: PlanAlignClusterVerdict['verdict']
  rationale: string
  customizationTrap: boolean
  /** The cluster's name as confirmed at gate A; '' when unresolvable. */
  name: string
  /** Stage-1's one-line thrust, carried through gate A; '' when unresolvable. */
  thrust: string
  /** The ideas this cluster holds — what the verdict is actually about. */
  ideas: AlignGateIdea[]
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

/**
 * The clustering gate A confirmed (falling back to Stage-1's raw output, as the
 * cluster-gate view does). Returns undefined rather than throwing: gate B's job
 * is the verdicts, and a missing CLUSTER record must degrade the card's label,
 * not close the gate.
 */
async function loadConfirmedClustering(
  planRunId: string
): Promise<ClusterGateOutput | undefined> {
  const record = await planRunRepository.findStageRecord(planRunId, 'CLUSTER')
  if (!record) return undefined
  const raw = record.humanConfirmedOutput ?? record.llmRawOutput
  return isClusterGateOutput(raw) ? raw : undefined
}

/** Shape-check the stored JSON before trusting it as a clustering. The column is
 *  an untyped blob, and a malformed one must degrade the cards' labels — not
 *  throw the reviewer out of a gate whose verdicts are perfectly readable. */
function isClusterGateOutput(raw: unknown): raw is ClusterGateOutput {
  if (!raw || typeof raw !== 'object') return false
  const { clusters } = raw as { clusters?: unknown }
  return (
    Array.isArray(clusters) &&
    clusters.every(
      c =>
        !!c &&
        typeof c === 'object' &&
        typeof (c as ClusterGateCluster).name === 'string' &&
        Array.isArray((c as ClusterGateCluster).ideaIds)
    )
  )
}

/** id → statement for every idea on the board (empty map when there's none). */
async function loadIdeaStatements(
  board: ClusterGateOutput | undefined
): Promise<Map<string, string>> {
  if (!board) return new Map()
  const ids = collectClusterGateIds(board).filter(
    (id): id is string => typeof id === 'string'
  )
  if (ids.length === 0) return new Map()
  const rows = await ideaRepository.findByIds(ids)
  return new Map(rows.map(i => [i.id, i.statement]))
}

export const planGateService = {
  /**
   * Render source for the gate-B board: the ALIGN LLM verdicts, one per
   * cluster. 409 unless the run is parked at ALIGNMENT_READY with an ALIGN
   * record. 404 if the run is missing.
   */
  async getAlignGate(planRunId: string): Promise<AlignGateView> {
    const { run, aligned } = await loadOpenAlignGate(planRunId)

    // A verdict alone is anonymous — the reviewer can't tell WHICH cluster it
    // judges (LUM-685). The identity lives in the CLUSTER record, joined back
    // by the snapshot-local `cluster-<i>` id Stage-2 minted from its index.
    // Fail-soft: an unresolvable id yields a card with an empty name rather
    // than dropping the verdict or 500ing the whole gate.
    const board = await loadConfirmedClustering(run.id)
    const statementById = await loadIdeaStatements(board)

    return {
      planRunId: run.id,
      stage: run.stage,
      clusters: aligned.clusters.map(c => {
        const index = clusterIndexFromId(c.clusterId)
        const source = index === null ? undefined : board?.clusters[index]
        return {
          clusterId: c.clusterId,
          verdict: c.verdict,
          rationale: c.rationale,
          customizationTrap: c.customizationTrap,
          name: source?.name ?? '',
          thrust: source?.thrust ?? '',
          ideas: (source?.ideaIds ?? []).map(id => ({
            id,
            statement: statementById.get(id) ?? id,
          })),
        }
      }),
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
   *
   * Each cluster's `ideaIds` is the reviewer's per-idea 取舍 (LUM-688), checked
   * against gate A's confirmed clustering: an id from another cluster is a 422,
   * and omitting the field keeps the whole cluster.
   */
  async confirmAlignGate(args: {
    planRunId: string
    memberId: string
    input: ConfirmAlignGateInput
  }): Promise<ConfirmAlignGateResult> {
    const { run, aligned } = await loadOpenAlignGate(args.planRunId)
    // Gate A's clustering is the authority for which ideas a cluster owns —
    // loaded the same fail-soft way the board's labels are (LUM-685).
    const board = await loadConfirmedClustering(run.id)

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

    const clusters: ConfirmedAlignCluster[] = args.input.clusters.map(c => {
      const ideaIds = resolveKeptIdeaIds({
        clusterId: c.clusterId,
        universe: clusterIdeaUniverse(c.clusterId, board),
        submitted: c.ideaIds,
      })
      // The schema catches an explicitly-emptied starred cluster; this also
      // catches a star on a cluster whose ideas were never resolvable, so a
      // corrupt clustering can't put an empty "plan this now" into Stage 3.
      if (c.starred && ideaIds.length === 0) {
        badRequest(
          `Cluster "${c.clusterId}" is starred but keeps no ideas — there is nothing to plan`,
          422
        )
      }
      return {
        clusterId: c.clusterId,
        verdict: c.verdict,
        starred: c.starred,
        rationale: c.rationale,
        // Server-authoritative: the trap flag can't be edited away at the gate.
        customizationTrap: trapById.get(c.clusterId) ?? false,
        ideaIds,
      }
    })

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
