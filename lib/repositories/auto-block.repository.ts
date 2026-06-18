import { prisma } from '@/lib/db/prisma'
import { Prisma } from '@prisma/client'

/**
 * Ledger for the server-side auto-blocking automation (LUM-544, Section 3).
 * One ACTIVE row per task is the source of truth for "Lumo auto-applied the
 * `blocked` tag" — distinct from a human-applied tag, which has no row here.
 */
export const autoBlockRepository = {
  /**
   * Insert one ACTIVE auto-block, no-op if the task already has a live one.
   * Idempotency rests on the partial unique index `auto_blocks_active_task_uq`
   * (one ACTIVE per task): the second insert hits the conflict and
   * `ON CONFLICT DO NOTHING` swallows it. Returns true when THIS call created
   * the row (so the caller knows whether to actually attach the tag), false
   * when one already existed.
   *
   * Raw SQL is the deliberate exception here: `ON CONFLICT` against a *partial*
   * unique index can't be expressed through the typed client's `create`.
   * Every value is bound as a parameter — never interpolated.
   */
  async insertIfAbsent(input: {
    taskId: string
    triggeringSessionId: string | null
    model: string | null
    topFailureLabel: string | null
    failureCount: number
  }): Promise<boolean> {
    const id = `ab_${crypto.randomUUID()}`
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      INSERT INTO "auto_blocks"
        ("id", "taskId", "triggeringSessionId", "model", "topFailureLabel", "failureCount", "active", "blockedAt")
      VALUES
        (${id}, ${input.taskId}, ${input.triggeringSessionId}, ${input.model}, ${input.topFailureLabel}, ${input.failureCount}, true, NOW())
      ON CONFLICT DO NOTHING
      RETURNING "id"
    `)
    return rows.length > 0
  },

  /** The live auto-block for a task, or null. */
  async findActiveByTask(taskId: string) {
    return prisma.autoBlock.findFirst({
      where: { taskId, active: true },
      select: { id: true, taskId: true, triggeringSessionId: true },
    })
  },

  /**
   * Resolve (deactivate) the task's ACTIVE auto-block on progress. `updateMany`
   * so a task with no live row is a harmless no-op. Returns how many rows
   * flipped (0 or 1) — the caller removes the shared tag only when this is 1,
   * so a human-applied `blocked` (no AutoBlock row) is never auto-cleared.
   */
  async resolveActiveByTask(taskId: string): Promise<number> {
    const res = await prisma.autoBlock.updateMany({
      where: { taskId, active: true },
      data: { active: false, resolvedAt: new Date() },
    })
    return res.count
  },
}
