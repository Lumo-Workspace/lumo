import { prisma } from '@/lib/db/prisma'
import type {
  Prisma,
  AcceptanceCriterionSource,
  MilestoneExitVerdict,
  ReferentKind,
} from '@prisma/client'

/**
 * LUM-643: milestone-level exit criteria — dumb reads/writes only. The close
 * gate, the referent-grounding rules and the replace semantics live in
 * `lib/services/milestone-exit-criteria.service`.
 */
export interface CreateMilestoneExitCriterionInput {
  milestoneId: string
  statement: string
  referentKind: ReferentKind
  source: AcceptanceCriterionSource
  /** Drafting session provenance (LUM-640 steward attribution), FK-less. */
  sourceSessionId?: string | null
}

export interface MilestoneExitVerdictInput {
  verdict: MilestoneExitVerdict
  verdictNote?: string | null
  verdictEvidence?: string | null
  verdictByMemberId: string
  verdictSessionId?: string | null
  verdictAt: Date
}

const exitCriterionSelect = {
  id: true,
  milestoneId: true,
  statement: true,
  referentKind: true,
  source: true,
  sourceSessionId: true,
  verdict: true,
  verdictNote: true,
  verdictEvidence: true,
  verdictByMemberId: true,
  verdictSessionId: true,
  verdictAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.MilestoneExitCriterionSelect

export type MilestoneExitCriterionRow =
  Prisma.MilestoneExitCriterionGetPayload<{
    select: typeof exitCriterionSelect
  }>

export const milestoneExitCriterionRepository = {
  /** Batch-insert (a contract draft). No-op for an empty batch. */
  async createMany(
    inputs: CreateMilestoneExitCriterionInput[],
    tx?: Prisma.TransactionClient
  ) {
    if (inputs.length === 0) return { count: 0 }
    const client = tx ?? prisma
    return client.milestoneExitCriterion.createMany({
      data: inputs.map(i => ({
        milestoneId: i.milestoneId,
        statement: i.statement,
        referentKind: i.referentKind,
        source: i.source,
        sourceSessionId: i.sourceSessionId ?? null,
      })),
    })
  },

  /** A milestone's active contract, oldest first (draft order). */
  async listByMilestone(
    milestoneId: string,
    tx?: Prisma.TransactionClient
  ): Promise<MilestoneExitCriterionRow[]> {
    const client = tx ?? prisma
    return client.milestoneExitCriterion.findMany({
      where: { milestoneId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: exitCriterionSelect,
    })
  },

  /** Active + tombstoned, oldest first — audit views. */
  async listByMilestoneIncludingDeleted(
    milestoneId: string,
    tx?: Prisma.TransactionClient
  ): Promise<MilestoneExitCriterionRow[]> {
    const client = tx ?? prisma
    return client.milestoneExitCriterion.findMany({
      where: { milestoneId },
      orderBy: { createdAt: 'asc' },
      select: exitCriterionSelect,
    })
  },

  async findById(
    id: string,
    tx?: Prisma.TransactionClient
  ): Promise<MilestoneExitCriterionRow | null> {
    const client = tx ?? prisma
    return client.milestoneExitCriterion.findUnique({
      where: { id },
      select: exitCriterionSelect,
    })
  },

  /**
   * Active criteria not adjudicated MET — the rows that hold the close gate
   * shut (verdict null = unadjudicated, NOT_MET = adjudicated unmet).
   */
  async listUnresolved(
    milestoneId: string,
    tx?: Prisma.TransactionClient
  ): Promise<MilestoneExitCriterionRow[]> {
    const client = tx ?? prisma
    return client.milestoneExitCriterion.findMany({
      where: {
        milestoneId,
        deletedAt: null,
        OR: [{ verdict: null }, { verdict: 'NOT_MET' }],
      },
      orderBy: { createdAt: 'asc' },
      select: exitCriterionSelect,
    })
  },

  /** Count-only variant of listUnresolved for the hot read/rollup paths. */
  async countUnresolved(
    milestoneId: string,
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const client = tx ?? prisma
    return client.milestoneExitCriterion.count({
      where: {
        milestoneId,
        deletedAt: null,
        OR: [{ verdict: null }, { verdict: 'NOT_MET' }],
      },
    })
  },

  /** Stamp an adjudication in place (latest verdict wins). */
  async setVerdict(
    id: string,
    input: MilestoneExitVerdictInput,
    tx?: Prisma.TransactionClient
  ): Promise<MilestoneExitCriterionRow> {
    const client = tx ?? prisma
    return client.milestoneExitCriterion.update({
      where: { id },
      data: {
        verdict: input.verdict,
        verdictNote: input.verdictNote ?? null,
        verdictEvidence: input.verdictEvidence ?? null,
        verdictByMemberId: input.verdictByMemberId,
        verdictSessionId: input.verdictSessionId ?? null,
        verdictAt: input.verdictAt,
      },
      select: exitCriterionSelect,
    })
  },

  /** Tombstone an adjudicated row so its verdict trail survives replace. */
  async softDelete(id: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.milestoneExitCriterion.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    })
  },

  /** Hard-delete a verdict-free row on contract replace. */
  async delete(id: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.milestoneExitCriterion.delete({
      where: { id },
      select: { id: true },
    })
  },
}
