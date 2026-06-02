import { prisma } from '@/lib/db/prisma'

interface UpsertWorktreeParams {
  workspaceId: string
  path: string
  /** Branch from the WORKTREE_CREATE payload, or null when absent. */
  branch: string | null
}

interface MarkRemovedParams {
  workspaceId: string
  path: string
  now: Date
}

export const worktreeRepository = {
  /**
   * Create or revive a Worktree row keyed by (workspaceId, path). A repeat
   * WORKTREE_CREATE for the same path refreshes the branch and clears any prior
   * `removedAt` (the worktree exists again). A null branch never overwrites a
   * previously-known branch — we'd rather keep a stale-but-present branch label
   * than blank it out.
   */
  async upsertWorktree(params: UpsertWorktreeParams) {
    return prisma.worktree.upsert({
      where: {
        workspaceId_path: {
          workspaceId: params.workspaceId,
          path: params.path,
        },
      },
      create: {
        workspaceId: params.workspaceId,
        path: params.path,
        branch: params.branch,
      },
      update: {
        ...(params.branch !== null ? { branch: params.branch } : {}),
        removedAt: null,
      },
      select: { id: true },
    })
  },

  /** Stamp `removedAt` on the worktree at this path (idempotent no-op if none). */
  async markRemoved(params: MarkRemovedParams) {
    return prisma.worktree.updateMany({
      where: { workspaceId: params.workspaceId, path: params.path },
      data: { removedAt: params.now },
    })
  },
}
