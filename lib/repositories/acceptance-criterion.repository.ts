import { prisma } from '@/lib/db/prisma'
import type {
  Prisma,
  AcceptanceVerifierType,
  AcceptanceCriterionSource,
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
  source: AcceptanceCriterionSource
  /** Omitted → column default 0 (initial draft). */
  addedAtRound?: number
}

/** Patch for a HUMAN_EDIT revision. The 3–7 soft cap and the agent-lock rule
 * (agent can't edit its own contract once work started) live in the service
 * layer — this repository stays a dumb write. */
export interface UpdateAcceptanceCriterionInput {
  statement?: string
  verifierType?: AcceptanceVerifierType
  checkpointer?: string | null
  evidenceRequired?: boolean
  source?: AcceptanceCriterionSource
}

const criterionSelect = {
  id: true,
  taskId: true,
  statement: true,
  verifierType: true,
  checkpointer: true,
  evidenceRequired: true,
  source: true,
  addedAtRound: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AcceptanceCriterionSelect

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
        ...(i.evidenceRequired !== undefined
          ? { evidenceRequired: i.evidenceRequired }
          : {}),
        source: i.source,
        ...(i.addedAtRound !== undefined ? { addedAtRound: i.addedAtRound } : {}),
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
        ...(input.evidenceRequired !== undefined
          ? { evidenceRequired: input.evidenceRequired }
          : {}),
        source: input.source,
        ...(input.addedAtRound !== undefined
          ? { addedAtRound: input.addedAtRound }
          : {}),
      },
      select: criterionSelect,
    })
  },

  /** A task's contract, oldest first (draft order, then later additions). */
  async listByTask(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.acceptanceCriterion.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      select: criterionSelect,
    })
  },

  async findById(id: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.acceptanceCriterion.findUnique({
      where: { id },
      select: criterionSelect,
    })
  },

  /** Criterion count for the 3–7 soft-cap check (service-layer warning). */
  async countByTask(taskId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.acceptanceCriterion.count({ where: { taskId } })
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

  async delete(id: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? prisma
    return client.acceptanceCriterion.delete({
      where: { id },
      select: { id: true },
    })
  },
}
