import { prisma } from '@/lib/db/prisma'

/**
 * LUM-1332 — the queries the self-host config check needs: proves the app
 * reaches its database and that the schema is there (a missing `workspaces` table
 * fails it), and counts accounts for the local-mode check (LUM-1335).
 */
export const selfHostCheckRepository = {
  async pingDatabase(): Promise<void> {
    await prisma.workspace.findFirst({ select: { id: true } })
  },

  /** LUM-1335 — accounts (`auth_users` rows), counted up to `limit`. */
  async countAccounts(limit: number): Promise<number> {
    const rows = await prisma.authUser.findMany({
      select: { id: true },
      take: limit,
    })
    return rows.length
  },
}
