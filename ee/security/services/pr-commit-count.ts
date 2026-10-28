import { logger } from '@/lib/logger'
import {
  gitProviderFor,
  type GitProviderRef,
} from '@/lib/integrations/git-provider/resolve'

export interface CommitCountPr extends GitProviderRef {
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
    return await gitProviderFor(pr).fetchPrCommitCount({
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
