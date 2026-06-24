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
}
