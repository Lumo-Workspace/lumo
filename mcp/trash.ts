import type { PrismaClient } from '@prisma/client'

/**
 * LUM-923 — the legacy stdio MCP's `delete_task` moves the task to the trash
 * like every other delete path (LUM-918), instead of hard-deleting it. The
 * root keeps `trashRootId` null; every live descendant points at it, so a
 * restore or the 30-day purge takes the whole group. Mirrors
 * `trashService.trashTask`; the client is passed in because this process
 * owns its own PrismaClient (mcp/db.ts).
 */
export async function trashTaskGroup(
  db: PrismaClient,
  rootId: string,
  deletedByClerkId: string | null,
  now: Date = new Date()
): Promise<number> {
  const descendants: string[] = []
  let frontier = [rootId]
  while (frontier.length > 0) {
    const children = await db.task.findMany({
      where: { parentTaskId: { in: frontier } },
      select: { id: true },
    })
    frontier = children.map(c => c.id)
    descendants.push(...frontier)
  }
  const stamp = { deletedAt: now, deletedByClerkId }
  await db.$transaction(async tx => {
    await tx.task.update({
      where: { id: rootId },
      data: { ...stamp, trashRootId: null },
    })
    if (descendants.length > 0) {
      await tx.task.updateMany({
        where: { id: { in: descendants } },
        data: { ...stamp, trashRootId: rootId },
      })
    }
  })
  return descendants.length
}
