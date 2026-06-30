import { logger } from '@/lib/logger'
import {
  loadTaskInputs,
  type TaskClaimInputs,
} from '@/lib/claim-faithfulness/task-inputs'
import {
  resolveDeliveryViaGithub,
  type MergedPrRef,
} from '@/lib/claim-faithfulness/delivery-github'
import { isClaimDeliveryMismatch } from '@/lib/claim-faithfulness/delivery-pairing'
import { classifyClaimFaithfulness } from '@/lib/claim-faithfulness/classify'
import {
  buildVerdictRow,
  claimFaithfulnessVerdictRepository,
  isFreshVerdict,
} from '@/lib/repositories/claim-faithfulness-verdict.repository'
import type {
  ClaimFaithfulnessResult,
  TaskDelivery,
} from '@/lib/claim-faithfulness/types'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { REASONING_MODEL } from '@/lib/ai/models'

const JUDGE_TIMEOUT = 90_000

export interface ClaimFaithfulnessDeps {
  loadTaskInputs: (taskId: string) => Promise<TaskClaimInputs | null>
  listMergedPRs: (taskId: string) => Promise<MergedPrRef[]>
  resolveDelivery: (args: {
    identifier: string
    mergedPRs: MergedPrRef[]
  }) => Promise<TaskDelivery | null>
  classify: (
    input: {
      claim: string | null
      delivery: TaskDelivery | null
      criteria: string[]
    },
    deps: { timeoutMs?: number }
  ) => Promise<ClaimFaithfulnessResult>
  // LUM-618: distinct sessions that produced a MERGED lineage edge for the task
  // (the DB fact of delivery), used to pair the claim with its delivery.
  listMergedSessionIds: (taskId: string) => Promise<string[]>
  upsertVerdict: (row: ReturnType<typeof buildVerdictRow>) => Promise<void>
  findWatermark: (
    taskId: string
  ) => Promise<{ judgedClaimAt: Date | null; verdict: string } | null>
  listCandidates: () => Promise<{ id: string; claimSnapshotAt: Date | null }[]>
  listWatermarks: () => Promise<Map<string, Date | null>>
  judgeModel: string
  timeoutMs: number
}

/**
 * LUM-618 verdict for a claim that describes a delivery not yet merged (its
 * session is not among the task's merged-delivery sessions). UNJUDGEABLE — not a
 * faithfulness call against a mismatched delivery — with a `diffScope` of 0.
 */
const DELIVERY_MISMATCH_RESULT: ClaimFaithfulnessResult = {
  verdict: 'UNJUDGEABLE',
  evidence: [],
  reasoning:
    'claim describes a delivery not yet merged (the claiming session is not among the task’s merged deliveries); judging deferred until it merges',
  prefilterSignal: null,
  diffScope: 0,
}

export function createClaimFaithfulnessService(deps: ClaimFaithfulnessDeps) {
  async function judgeTask(taskId: string): Promise<string | null> {
    const inputs = await deps.loadTaskInputs(taskId)
    if (!inputs) return null

    // LUM-618: the claim snapshot is overwritten by the LATEST `verify --note`,
    // but the delivery resolver builds the diff from the task's MERGED PRs. When
    // the latest claim came from a session whose follow-up PR is still open
    // while an OLDER PR from a different session has merged, comparing that claim
    // against the merged diff falsely reads OVERSTATED. Gate it BEFORE the
    // freshness short-circuit so an already-recorded (mismatched) verdict is
    // healed too: record UNJUDGEABLE with a NULL watermark — never a fresh
    // blocking verdict — so the sweep keeps re-evaluating until the claiming
    // session itself merges (its lineage edge stamps MERGED → the gate clears →
    // the next pass re-judges against the full delivery).
    const mergedSessionIds = await deps.listMergedSessionIds(taskId)
    if (
      isClaimDeliveryMismatch(inputs.claimSnapshotSessionId, mergedSessionIds)
    ) {
      await deps.upsertVerdict(
        buildVerdictRow(
          taskId,
          inputs.identifier,
          null,
          DELIVERY_MISMATCH_RESULT,
          null,
          deps.judgeModel
        )
      )
      return DELIVERY_MISMATCH_RESULT.verdict
    }

    const existing = await deps.findWatermark(taskId)
    if (
      existing &&
      isFreshVerdict(existing.judgedClaimAt, inputs.claimSnapshotAt)
    ) {
      return existing.verdict
    }

    const mergedPRs = await deps.listMergedPRs(taskId)
    const delivery = await deps.resolveDelivery({
      identifier: inputs.identifier,
      mergedPRs,
    })
    const result = await deps.classify(
      { claim: inputs.claim, delivery, criteria: inputs.criteria },
      { timeoutMs: deps.timeoutMs }
    )
    await deps.upsertVerdict(
      buildVerdictRow(
        taskId,
        inputs.identifier,
        delivery,
        result,
        inputs.claimSnapshotAt,
        deps.judgeModel
      )
    )
    return result.verdict
  }

  async function sweepUnjudged(batch: number): Promise<{ processed: number }> {
    const watermarks = await deps.listWatermarks()
    const candidates = await deps.listCandidates()
    const due = candidates
      // A candidate with no verdict row yet is always due (parity with the
      // webhook path + the operational script), even when claimSnapshotAt is
      // null — otherwise isFreshVerdict(null, null) would wrongly skip it and
      // leave it PENDING forever. Skip only when a *fresh* row already exists.
      .filter(
        c =>
          !watermarks.has(c.id) ||
          !isFreshVerdict(watermarks.get(c.id) ?? null, c.claimSnapshotAt)
      )
      .slice(0, batch)

    let processed = 0
    for (const t of due) {
      try {
        await judgeTask(t.id)
      } catch (err) {
        logger.error(
          `[claim-faithfulness] sweep judgeTask failed for ${t.id}: ${(err as Error).message}`
        )
      }
      processed++
    }
    return { processed }
  }

  return { judgeTask, sweepUnjudged }
}

export const claimFaithfulnessService = createClaimFaithfulnessService({
  loadTaskInputs,
  listMergedPRs: taskId => pullRequestRepository.listMergedByTask(taskId),
  listMergedSessionIds: taskId =>
    lineageEdgeRepository.findMergedSessionIds(taskId),
  resolveDelivery: resolveDeliveryViaGithub,
  classify: classifyClaimFaithfulness,
  upsertVerdict: row => claimFaithfulnessVerdictRepository.upsert(row),
  findWatermark: async taskId => {
    const r = await claimFaithfulnessVerdictRepository.findByTaskId(taskId)
    return r ? { judgedClaimAt: r.judgedClaimAt, verdict: r.verdict } : null
  },
  listCandidates: () => taskRepository.listFaithfulnessCandidates(),
  listWatermarks: () => claimFaithfulnessVerdictRepository.listWatermarks(),
  // judgeModel is the provenance label stored on the verdict row; it must match
  // the model the judge client actually runs (REASONING_MODEL) — LUM-587.
  judgeModel: REASONING_MODEL,
  timeoutMs: JUDGE_TIMEOUT,
})
