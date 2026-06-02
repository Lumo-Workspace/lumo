import { worktreeRepository } from '@/lib/repositories/worktree.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'

interface WorktreeCreateInput {
  workspaceId: string
  /** worktree_path from the payload; null when absent. */
  path: string | null
  /** branch from the payload; null when absent. */
  branch: string | null
}

interface WorktreeRemoveInput {
  workspaceId: string
  path: string | null
  now: Date
}

export const worktreeService = {
  /**
   * Record a worktree from a WORKTREE_CREATE hook and link any sessions already
   * running in it (cwd == path) so the parallel-edit collision warning can name
   * their branch (LUM-150 ②). No-ops when the payload carried no path.
   */
  async handleWorktreeCreate(input: WorktreeCreateInput): Promise<void> {
    if (!input.path) return
    const worktree = await worktreeRepository.upsertWorktree({
      workspaceId: input.workspaceId,
      path: input.path,
      branch: input.branch,
    })
    await sessionRepository.linkToWorktreeByCwd({
      workspaceId: input.workspaceId,
      path: input.path,
      worktreeId: worktree.id,
    })
  },

  /** Mark a worktree removed from a WORKTREE_REMOVE hook. No-ops without a path. */
  async handleWorktreeRemove(input: WorktreeRemoveInput): Promise<void> {
    if (!input.path) return
    await worktreeRepository.markRemoved({
      workspaceId: input.workspaceId,
      path: input.path,
      now: input.now,
    })
  },
}
