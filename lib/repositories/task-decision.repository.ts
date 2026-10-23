import { Prisma } from '@prisma/client'
import { scopedPrisma as prisma, unscoped } from '@/lib/db/workspace-scope'
import {
  redactStoredFields,
  STORAGE_REDACTED_FIELDS,
} from '@/lib/security-scan/storage-redaction'

/**
 * LUM-1303: task decisions. Every query pins `workspaceId` (scopedPrisma), so
 * another workspace's decision id reads as missing. Writes take an optional
 * `tx` so the service can record the Activity entry in the same transaction
 * (the filters still pin the workspace there).
 *
 * Numbers ("Decision 3") are per task, max+1 over every row including deleted
 * ones (a delete only sets `deletedAt`), so a number is never handed out
 * twice. Reads skip deleted rows.
 */

const DECISION_SELECT = {
  id: true,
  taskId: true,
  number: true,
  text: true,
  rationale: true,
  sourceSessionId: true,
  createdAt: true,
  updatedAt: true,
  createdById: true,
} as const

export interface CreateTaskDecisionInput {
  taskId: string
  workspaceId: string
  text: string
  rationale: string | null
  createdById: string | null
  sourceSessionId: string | null
}

export interface UpdateTaskDecisionInput {
  text?: string
  rationale?: string | null
}

export const taskDecisionRepository = {
  /** By number (= the order the rulings were made in); deleted ones skipped. */
  async listByTask(taskId: string, workspaceId: string) {
    return prisma.taskDecision.findMany({
      where: { taskId, workspaceId, deletedAt: null },
      select: DECISION_SELECT,
      orderBy: { number: 'asc' },
    })
  },

  async findById(id: string, workspaceId: string) {
    return prisma.taskDecision.findFirst({
      where: { id, workspaceId, deletedAt: null },
      select: {
        id: true,
        taskId: true,
        number: true,
        text: true,
        rationale: true,
      },
    })
  },

  /**
   * Create with the task's next number. Two concurrent writes can compute the
   * same max+1; the (taskId, number) unique key turns that into a P2002, which
   * {@link isDecisionNumberCollision} recognises so the caller can retry the
   * whole transaction (a failed statement aborts it in Postgres).
   */
  async createNumbered(
    input: CreateTaskDecisionInput,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx ?? prisma
    const agg = await client.taskDecision.aggregate({
      where: { taskId: input.taskId, workspaceId: input.workspaceId },
      _max: { number: true },
    })
    return client.taskDecision.create({
      data: {
        ...redactStoredFields(input, STORAGE_REDACTED_FIELDS.taskDecision),
        number: (agg._max.number ?? 0) + 1,
      },
      select: DECISION_SELECT,
    })
  },

  async update(
    id: string,
    workspaceId: string,
    input: UpdateTaskDecisionInput,
    tx?: Prisma.TransactionClient
  ) {
    // `deletedAt: null`: a decision deleted after the caller looked it up is
    // not edited back to life — Prisma throws P2025 instead.
    return (tx ?? prisma).taskDecision.update({
      where: { id, workspaceId, deletedAt: null },
      data: redactStoredFields(input, STORAGE_REDACTED_FIELDS.taskDecision),
      select: DECISION_SELECT,
    })
  },

  /** Tombstone: the row (and so its number) stays; reads skip it. */
  async softDelete(
    id: string,
    workspaceId: string,
    tx?: Prisma.TransactionClient
  ) {
    await (tx ?? prisma).taskDecision.update({
      where: { id, workspaceId, deletedAt: null },
      data: { deletedAt: new Date() },
    })
  },

  /**
   * Backfill: a page of tasks (trash included) whose description may hold a
   * LUM-970 `## Decisions` section — a cheap text prefilter; the caller parses.
   */
  async listTasksWithDecisionsHeading(afterId: string | null, take: number) {
    return unscoped('LUM-1303 decisions backfill').task.findMany({
      where: {
        deletedAt: {},
        // Loose on purpose (a heading may wrap the word in <strong> etc.):
        // the caller's parser decides whether a real section is there.
        description: { contains: 'decisions', mode: 'insensitive' },
      },
      select: {
        id: true,
        workspaceId: true,
        description: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
      take,
      ...(afterId ? { cursor: { id: afterId }, skip: 1 } : {}),
    })
  },

  /**
   * Backfill: write the parsed decisions and the description without its
   * section in one transaction. Skips the task when its description changed
   * since it was read (a concurrent edit wins; a re-run picks it up).
   */
  async moveFromDescription(args: {
    taskId: string
    workspaceId: string
    expectedDescription: string
    description: string
    decisions: Array<{ text: string; createdAt: Date }>
  }): Promise<boolean> {
    return unscoped('LUM-1303 decisions backfill').$transaction(async tx => {
      const updated = await tx.task.updateMany({
        where: {
          id: args.taskId,
          workspaceId: args.workspaceId,
          description: args.expectedDescription,
        },
        data: { description: args.description || null },
      })
      if (updated.count !== 1) return false
      if (args.decisions.length > 0) {
        // Numbered after anything recorded on the tab already (run the
        // backfill right after the deploy and there is nothing).
        const agg = await tx.taskDecision.aggregate({
          where: { taskId: args.taskId, workspaceId: args.workspaceId },
          _max: { number: true },
        })
        const base = agg._max.number ?? 0
        await tx.taskDecision.createMany({
          data: args.decisions.map((d, i) =>
            redactStoredFields(
              {
                taskId: args.taskId,
                workspaceId: args.workspaceId,
                number: base + i + 1,
                text: d.text,
                rationale: null,
                createdById: null,
                sourceSessionId: null,
                createdAt: d.createdAt,
              },
              STORAGE_REDACTED_FIELDS.taskDecision
            )
          ),
        })
      }
      return true
    })
  },
}

export type TaskDecisionRow = Awaited<
  ReturnType<typeof taskDecisionRepository.createNumbered>
>

/** True when an update / delete found no live row (deleted in the meantime). */
export function isDecisionGone(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025'
}

/** True for the (taskId, number) unique-key race of {@link taskDecisionRepository.createNumbered}. */
export function isDecisionNumberCollision(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
}
