import { logger } from '@/lib/logger'
import {
  loadTaskInputs,
  type TaskClaimInputs,
} from '@/lib/claim-faithfulness/task-inputs'
import {
  resolveDeliveryViaGithub,
  type MergedPrRef,
} from '@/lib/claim-faithfulness/delivery-github'
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
  upsertVerdict: (row: ReturnType<typeof buildVerdictRow>) => Promise<void>
  findWatermark: (
    taskId: string
  ) => Promise<{ judgedClaimAt: Date | null; verdict: string } | null>
  listCandidates: () => Promise<{ id: string; claimSnapshotAt: Date | null }[]>
  listWatermarks: () => Promise<Map<string, Date | null>>
  judgeModel: string
  timeoutMs: number
}

export function createClaimFaithfulnessService(deps: ClaimFaithfulnessDeps) {
  async function judgeTask(taskId: string): Promise<string | null> {
    const inputs = await deps.loadTaskInputs(taskId)
    if (!inputs) return null

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
