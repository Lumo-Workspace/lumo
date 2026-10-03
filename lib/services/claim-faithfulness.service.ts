import { logger } from '@/lib/logger'
import {
  loadTaskInputs,
  type TaskClaimInputs,
} from '@/lib/claim-faithfulness/task-inputs'
import {
  resolveDeliveryViaGithub,
  type MergedPrRef,
} from '@/lib/claim-faithfulness/delivery-github'
import {
  hasDeliveryGrown,
  isClaimDeliveryMismatch,
} from '@/lib/claim-faithfulness/delivery-pairing'
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
import { loadSecurityLayers } from '@/lib/services/security-workspace-switches.service'

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
    },
    deps: { timeoutMs?: number }
  ) => Promise<ClaimFaithfulnessResult>
  // LUM-618: distinct sessions that produced a MERGED lineage edge for the task
  // (the DB fact of delivery), used to pair the claim with its delivery.
  listMergedSessionIds: (taskId: string) => Promise<string[]>
  upsertVerdict: (row: ReturnType<typeof buildVerdictRow>) => Promise<void>
  // LUM-618: `prNumbers` is the delivery the verdict was judged against — the
  // second freshness axis (a verdict goes stale when the merged-PR set grows).
  findWatermark: (taskId: string) => Promise<{
    judgedClaimAt: Date | null
    verdict: string
    prNumbers: number[]
  } | null>
  // LUM-618: `mergedPrNumbers` is the task's CURRENT merged-PR set, compared
  // against each verdict's judged `prNumbers` to detect delivery growth.
  listCandidates: () => Promise<
    {
      id: string
      claimSnapshotAt: Date | null
      workspaceId: string
      mergedPrNumbers: number[]
    }[]
  >
  listWatermarks: () => Promise<
    Map<string, { judgedClaimAt: Date | null; prNumbers: number[] }>
  >
  // LUM-901: the judge sends the merged PR diff to a model, so it is part of
  // the workspace's AI review — read at run time, never cached across runs.
  isAiReviewOn: (workspaceId: string) => Promise<boolean>
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

/**
 * LUM-901 verdict when the workspace has AI review (or the whole scan) turned
 * off: no diff fetched, no model call. Written with a NULL watermark so the
 * task is judged normally once the switch is back on.
 */
export const AI_REVIEW_OFF_RESULT: ClaimFaithfulnessResult = {
  verdict: 'UNJUDGEABLE',
  evidence: [],
  reasoning:
    'not judged: AI review is turned off in this workspace’s settings, so no code was sent to a model',
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

    // LUM-618 (delivery-growth axis): a verdict is fresh only when BOTH the
    // claim is unchanged AND the delivery has not grown since it was judged.
    // PR-A merges → judged against [A]; PR-B merges later with the same claim →
    // the claim-keyed watermark still reads fresh, but the delivery is now
    // [A,B], so the verdict is pinned to the partial PR-A-only delivery (the
    // residual LUM-617 false OVERSTATED). Re-fetch the merged PRs up-front and
    // re-judge when the current set contains a PR the verdict never saw.
    const existing = await deps.findWatermark(taskId)
    const mergedPRs = await deps.listMergedPRs(taskId)
    if (
      existing &&
      isFreshVerdict(existing.judgedClaimAt, inputs.claimSnapshotAt) &&
      !hasDeliveryGrown(
        mergedPRs.map(p => p.number),
        existing.prNumbers
      )
    ) {
      return existing.verdict
    }

    // LUM-901: checked after the freshness short-circuit (an existing verdict
    // costs no model call) and before the diff is fetched.
    if (!(await deps.isAiReviewOn(inputs.workspaceId))) {
      await deps.upsertVerdict(
        buildVerdictRow(
          taskId,
          inputs.identifier,
          null,
          AI_REVIEW_OFF_RESULT,
          null,
          deps.judgeModel
        )
      )
      return AI_REVIEW_OFF_RESULT.verdict
    }

    const delivery = await deps.resolveDelivery({
      identifier: inputs.identifier,
      mergedPRs,
    })
    const result = await deps.classify(
      { claim: inputs.claim, delivery },
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
      // leave it PENDING forever. Skip only when a row exists that is fresh by
      // BOTH axes: claim unchanged AND delivery not grown (LUM-618). The
      // delivery axis is load-bearing here — without it the sweep's own
      // pre-filter would skip LUM-617 (fresh claim, but its verdict was judged
      // against PR-A only while PR-B has since merged) and judgeTask's gate
      // would never get the chance to re-judge.
      .filter(c => {
        const w = watermarks.get(c.id)
        if (!w) return true
        const fresh =
          isFreshVerdict(w.judgedClaimAt, c.claimSnapshotAt) &&
          !hasDeliveryGrown(c.mergedPrNumbers, w.prNumbers)
        return !fresh
      })

    // LUM-901: a workspace with AI review off is left out before the batch is
    // cut — its rows keep a NULL watermark, so without this they would fill
    // every batch and starve the workspaces that have it on.
    const switchByWorkspace = new Map<string, Promise<boolean>>()
    const aiReviewOn = (workspaceId: string) => {
      let on = switchByWorkspace.get(workspaceId)
      if (!on) {
        on = deps.isAiReviewOn(workspaceId)
        switchByWorkspace.set(workspaceId, on)
      }
      return on
    }
    const judgeable: typeof due = []
    for (const c of due) {
      if (judgeable.length >= batch) break
      if (await aiReviewOn(c.workspaceId)) judgeable.push(c)
    }

    let processed = 0
    for (const t of judgeable) {
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
    return r
      ? {
          judgedClaimAt: r.judgedClaimAt,
          verdict: r.verdict,
          prNumbers: r.prNumbers,
        }
      : null
  },
  listCandidates: () => taskRepository.listFaithfulnessCandidates(),
  listWatermarks: () => claimFaithfulnessVerdictRepository.listWatermarks(),
  isAiReviewOn: async workspaceId =>
    (await loadSecurityLayers(workspaceId)).aiReview,
  // judgeModel is the provenance label stored on the verdict row; it must match
  // the model the judge client actually runs (REASONING_MODEL) — LUM-587.
  judgeModel: REASONING_MODEL,
  timeoutMs: JUDGE_TIMEOUT,
})
