import { prisma } from '@/lib/db/prisma'
import type {
  Prisma,
  AcceptanceVerifierType,
  AcceptanceCriterionSource,
  ReferentKind,
} from '@prisma/client'

/**
 * One acceptance criterion to persist. `source` + `addedAtRound` carry the
 * feedback-loop provenance: the initial agent draft is AGENT_DRAFT at round 0,
 * review-time gap findings are REVIEW_ADDED at the round they surfaced.
 */
export interface CreateAcceptanceCriterionInput {
  taskId: string
  statement: string
  verifierType: AcceptanceVerifierType
  /** Executable check pointer; required for MACHINE at the validation layer. */
  checkpointer?: string | null
  evidenceRequired?: boolean
  /** Agent-drafted human-judging guidance for a HUMAN criterion (LUM-465). */
  judgeSteps?: string | null
  source: AcceptanceCriterionSource
  /** Omitted → column default 0 (initial draft). */
  addedAtRound?: number
  /** What this criterion anchors (LUM-602). Omitted → null (legacy/unclassified). */
  referentKind?: ReferentKind | null
  /** LUM-789: HUMAN_EDIT 来源写入时由服务层直接置位（人亲手写的合同天然已确认）。 */
  confirmedAt?: Date | null
  confirmedByMemberId?: string | null
}

/** Patch for a HUMAN_EDIT revision. The 3–7 soft cap and the agent-lock rule
 * (agent can't edit its own contract once work started) live in the service
 * layer — this repository stays a dumb write. */
export interface UpdateAcceptanceCriterionInput {
  statement?: string
  verifierType?: AcceptanceVerifierType
  checkpointer?: string | null
  evidenceRequired?: boolean
  judgeSteps?: string | null
  source?: AcceptanceCriterionSource
  referentKind?: ReferentKind | null
  /** LUM-789: HUMAN_EDIT 来源写入时由服务层直接置位（人亲手写的合同天然已确认）。 */
  confirmedAt?: Date | null
  confirmedByMemberId?: string | null
}

const criterionSelect = {
  id: true,
  taskId: true,
  statement: true,
  verifierType: true,
  checkpointer: true,
  evidenceRequired: true,
  judgeSteps: true,
  source: true,
  addedAtRound: true,
  referentKind: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  confirmedAt: true,
  confirmedByMemberId: true,
} satisfies Prisma.AcceptanceCriterionSelect

/**
 * A criterion's verifier is MACHINE or HUMAN — never AGENT. AGENT is a verdict
 * CHANNEL (who produced a verdict, LUM-422), not a way a criterion is checked;
 * the validation layer refuses an AGENT-typed criterion and nothing persists
 * one. The Prisma column shares the AcceptanceVerifierType enum (which gained
 * AGENT for verdict rows), so criterion reads are narrowed back to the honest
 * domain type here — read models stay MACHINE | HUMAN.
 */
export type CriterionVerifier = 'MACHINE' | 'HUMAN'

type RawCriterionRow = Prisma.AcceptanceCriterionGetPayload<{
  select: typeof criterionSelect
}>
export type AcceptanceCriterionRow = Omit<RawCriterionRow, 'verifierType'> & {
  verifierType: CriterionVerifier
}

export const acceptanceCriterionRepository = {
  /**
   * Batch-insert criteria (the initial round-0 draft). No-op for an empty
   * batch so callers can pass a filtered list without guarding. Optional
   * fields are omitted unless provided so column defaults apply.
   */
  async createMany(
    inputs: CreateAcceptanceCriterionInput[],
    tx?: Prisma.TransactionClient
  ) {
    if (inputs.length === 0) return { count: 0 }
    const client = tx ?? prisma
    return client.acceptanceCriterion.createMany({
      data: inputs.map(i => ({
        taskId: i.taskId,
        statement: i.statement,
        verifierType: i.verifierType,
        checkpointer: i.checkpointer ?? null,
        judgeSteps: i.judgeSteps ?? null,
        ...(i.evidenceRequired !== undefined
          ? { evidenceRequired: i.evidenceRequired }
          : {}),
        source: i.source,
        referentKind: i.referentKind ?? null,
        ...(i.addedAtRound !== undefined
          ? { addedAtRound: i.addedAtRound }
          : {}),
      })),
    })
  },

  /** Single insert — the REVIEW_ADDED append path (one gap at a time). */
  async create(
    input: CreateAcceptanceCriterionInput,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.acceptanceCriterion.create({
      data: {
        taskId: input.taskId,
        statement: input.statement,
        verifierType: input.verifierType,
        checkpointer: input.checkpointer ?? null,
        judgeSteps: input.judgeSteps ?? null,
        ...(input.evidenceRequired !== undefined
          ? { evidenceRequired: input.evidenceRequired }
          : {}),
        source: input.source,
        referentKind: input.referentKind ?? null,
        ...(input.addedAtRound !== undefined
          ? { addedAtRound: input.addedAtRound }
          : {}),
        ...(input.confirmedAt !== undefined
          ? { confirmedAt: input.confirmedAt }
          : {}),
        ...(input.confirmedByMemberId !== undefined
          ? { confirmedByMemberId: input.confirmedByMemberId }
          : {}),
      },
      select: criterionSelect,
    })
  },

  /** A task's contract, oldest first (draft order, then later additions).
   * Soft-deleted (tombstoned) rows are excluded — use listByTaskIncludingDeleted
   * for the status read model's "Removed" section or audit views. */
  async listByTask(
    taskId: string,
    tx?: Prisma.TransactionClient
  ): Promise<AcceptanceCriterionRow[]> {
    const client = tx ?? prisma
    const rows = await client.acceptanceCriterion.findMany({
      where: { taskId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: criterionSelect,
    })
    return rows as AcceptanceCriterionRow[]
  },

  /**
   * A task's full criterion history — active + tombstoned — oldest first.
   * Used by the status read model's "Removed" section and audit views where
   * the verdict→criterion chain must remain visible after soft-deletion.
   */
  async listByTaskIncludingDeleted(
    taskId: string,
    tx?: Prisma.TransactionClient
  ): Promise<AcceptanceCriterionRow[]> {
    const client = tx ?? prisma
    const rows = await client.acceptanceCriterion.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      select: criterionSelect,
    })
    return rows as AcceptanceCriterionRow[]
  },

  async findById(
    id: string,
    tx?: Prisma.TransactionClient
  ): Promise<AcceptanceCriterionRow | null> {
    const client = tx ?? prisma
    const row = await client.acceptanceCriterion.findUnique({
      where: { id },
      select: criterionSelect,
    })
    return row as AcceptanceCriterionRow | null
  },

  /** Criterion count for the 3–7 soft-cap check (service-layer warning).
   * Counts only active rows — soft-deleted tombstones are excluded. */
  async countByTask(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.acceptanceCriterion.count({
      where: { taskId, deletedAt: null },
    })
  },

  async update(
    id: string,
    patch: UpdateAcceptanceCriterionInput,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    return client.acceptanceCriterion.update({
      where: { id },
      data: patch,
      select: criterionSelect,
    })
  },

  /**
   * LUM-789: 盖确认戳。只动**未删除且尚未确认**的行 —— 重复确认是幂等的
   * no-op，原确认人与时间戳不被覆盖。返回本次真正盖上的行数。
   */
  async confirmAllActive(
    taskId: string,
    memberId: string,
    at: Date,
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const client = tx ?? prisma
    const { count } = await client.acceptanceCriterion.updateMany({
      where: { taskId, deletedAt: null, confirmedAt: null },
      data: { confirmedAt: at, confirmedByMemberId: memberId },
    })
    return count
  },

  /**
   * Soft-delete: stamps deletedAt on the row, keeping it (and its
   * VerificationRun rows) intact so the verdict→criterion audit chain
   * survives. Use for run-bearing criteria. Run-free criteria may use the
   * hard `delete` method below.
   */
  async softDelete(id: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.acceptanceCriterion.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { id: true },
    })
  },

  async delete(id: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.acceptanceCriterion.delete({
      where: { id },
      select: { id: true },
    })
  },

  /**
   * Active criteria across a workspace with just the fields that classify
   * referent kind (LUM-602). The service folds these into the effective-kind
   * tally — Prisma groupBy can't carry the derived value, so we return raw
   * classifying fields per row.
   */
  async listClassifyingFieldsForWorkspace(
    workspaceId: string,
    tx?: Prisma.TransactionClient
  ): Promise<
    Array<{
      referentKind: ReferentKind | null
      verifierType: AcceptanceVerifierType
      checkpointer: string | null
    }>
  > {
    const client = tx ?? prisma
    return client.acceptanceCriterion.findMany({
      where: { deletedAt: null, task: { project: { workspaceId } } },
      select: { referentKind: true, verifierType: true, checkpointer: true },
    })
  },
}
