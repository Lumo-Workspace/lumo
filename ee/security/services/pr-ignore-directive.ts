import { logger } from '@/lib/logger'
import { fetchPrBody } from '@/lib/integrations/github/contents'
import { hasIgnoreDirective } from '@/ee/security/security-scan/auto-review-policy'
import { prCommandHandle } from './pr-command-parse'

export interface IgnoreDirectivePr {
  workspaceId: string
  repo: string
  number: number
}

/**
 * LUM-1152 — does the PR's description, as it is NOW, carry
 * `@<app> ignore` (auto-review-policy.ts)? Read live, so an edit adding or
 * removing it holds from the next automatic scan on. Never throws: when the
 * description cannot be read the PR is reviewed as before (fail-open — the
 * directive is a cost opt-out, not a gate). No App slug configured = no
 * directive, and no GitHub call.
 */
export async function isPrReviewIgnored(
  pr: IgnoreDirectivePr
): Promise<boolean> {
  const handle = prCommandHandle()
  if (!handle) return false
  try {
    const body = await fetchPrBody({
      workspaceId: pr.workspaceId,
      fullName: pr.repo,
      prNumber: pr.number,
    })
    return hasIgnoreDirective(body, handle)
  } catch (error) {
    logger.info(
      `[pr-ignore-directive] description unavailable ${pr.repo}#${pr.number}: ${error instanceof Error ? error.message : error}`
    )
    return false
  }
}
