import { prisma } from '@/lib/db/prisma'

/**
 * LUM-1332 — the one query the self-host config check needs: proves the app
 * reaches its database and that the schema is there (a missing `workspaces` table
 * fails it).
 */
export const selfHostCheckRepository = {
  async pingDatabase(): Promise<void> {
    await prisma.workspace.findFirst({ select: { id: true } })
  },
}
