import { logger } from '@/lib/logger'
import { fetchPrCommitCount } from '@/lib/integrations/github/contents'

export interface CommitCountPr {
  workspaceId: string
  repo: string
  number: number
}

/**
 * LUM-1137 — the PR's commit count at `head`, or null when GitHub cannot say
 * (the reviewed-commit budget then counts one commit). Never throws.
 */
export async function prCommitCountBestEffort(
  pr: CommitCountPr,
  head: string
): Promise<number | null> {
  try {
    return await fetchPrCommitCount({
      workspaceId: pr.workspaceId,
      fullName: pr.repo,
      prNumber: pr.number,
      head,
    })
  } catch (error) {
    logger.info(
      `[pr-commit-count] commit count unavailable ${pr.repo}#${pr.number}: ${error instanceof Error ? error.message : error}`
    )
    return null
  }
}
