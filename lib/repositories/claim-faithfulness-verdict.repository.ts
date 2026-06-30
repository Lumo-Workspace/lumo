import { prisma } from '@/lib/db/prisma'
import type {
  TaskDelivery,
  ClaimFaithfulnessResult,
} from '@/lib/claim-faithfulness/types'

export interface VerdictUpsert {
  taskId: string
  verdict: string
  evidence: string[]
  reasoning: string
  diffShas: string[]
  prNumbers: number[]
  diffScope: number
  prefilterSignal: string | null
  judgeModel: string
  judgedClaimAt: Date | null
}

export function buildVerdictRow(
  taskId: string,
  _identifier: string,
  delivery: TaskDelivery | null,
  result: ClaimFaithfulnessResult,
  claimSnapshotAt: Date | null,
  judgeModel: string
): VerdictUpsert {
  return {
    taskId,
    verdict: result.verdict,
    evidence: result.evidence,
    reasoning: result.reasoning,
    diffShas: delivery?.shas ?? [],
    prNumbers: delivery?.prNumbers ?? [],
    diffScope: result.diffScope,
    prefilterSignal: result.prefilterSignal,
    judgeModel,
    judgedClaimAt: claimSnapshotAt,
  }
}

export const claimFaithfulnessVerdictRepository = {
  async upsert(row: VerdictUpsert): Promise<void> {
    const { taskId, evidence, ...rest } = row
    await prisma.claimFaithfulnessVerdict.upsert({
      where: { taskId },
      create: { taskId, evidence, ...rest, judgedAt: new Date() },
      update: { evidence, ...rest, judgedAt: new Date() },
    })
  },
  findByTaskId(taskId: string) {
    return prisma.claimFaithfulnessVerdict.findUnique({ where: { taskId } })
  },
  // taskId → freshness watermark, for sweep / --resume skip decisions. Carries
  // both axes: `judgedClaimAt` (claim staleness) and `prNumbers` (the delivery
  // the verdict was judged against, for LUM-618 delivery-growth staleness).
  async listWatermarks(): Promise<
    Map<string, { judgedClaimAt: Date | null; prNumbers: number[] }>
  > {
    const rows = await prisma.claimFaithfulnessVerdict.findMany({
      select: { taskId: true, judgedClaimAt: true, prNumbers: true },
    })
    return new Map(
      rows.map(r => [
        r.taskId,
        { judgedClaimAt: r.judgedClaimAt, prNumbers: r.prNumbers },
      ])
    )
  },
}

// A persisted verdict is "fresh" (safe to skip on --resume) when it was judged
// against a claim at least as new as the task's current claimSnapshot. A null
// claimSnapshotAt means there is nothing newer to judge → fresh. A verdict with
// a null watermark predates staleness tracking → treat as stale (re-judge).
export function isFreshVerdict(
  judgedClaimAt: Date | null,
  claimSnapshotAt: Date | null
): boolean {
  if (claimSnapshotAt === null) return true
  if (judgedClaimAt === null) return false
  return judgedClaimAt.getTime() >= claimSnapshotAt.getTime()
}
