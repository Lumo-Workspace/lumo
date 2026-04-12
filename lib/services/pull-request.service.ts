import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

// ── Pull Request Service ───────────────────────────────────────────────────

export const pullRequestService = {
  /** Search PRs in a workspace by number or title. */
  async searchByWorkspace(workspaceId: string, query: string, limit: number) {
    return pullRequestRepository.searchByWorkspace(workspaceId, query, limit)
  },

  /** Find the most recent open PR for a task. */
  async findActivePr(taskId: string) {
    return pullRequestRepository.findActivePr(taskId)
  },
}
