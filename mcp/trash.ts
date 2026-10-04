import type { PrismaClient } from '@prisma/client'

/**
 * LUM-923 — the legacy stdio MCP's `delete_task` moves the task to the trash
 * like every other delete path (LUM-918), instead of hard-deleting it. Since
 * LUM-959 a task has no subtasks, so it is trashed alone as its own root.
 * Mirrors `trashService.trashTask`; the client is passed in because this
 * process owns its own PrismaClient (mcp/db.ts).
 */
export async function trashTask(
  db: PrismaClient,
  taskId: string,
  deletedByClerkId: string | null,
  now: Date = new Date()
): Promise<void> {
  await db.task.update({
    where: { id: taskId },
    data: { deletedAt: now, deletedByClerkId, trashRootId: null },
  })
}
