/**
 * LUM-1153 — gathers what `@<app> configuration` shows for one PR: the
 * repository's effective review config as of the PR's BASE commit (the
 * commit a review applies — LUM-1146's `repoConfigService.effective()`,
 * values + sources), the workspace's stored switches and the layers that
 * run after the platform ceiling. Only the commanding workspace's own rows
 * are read; nothing secret is in any of them.
 *
 * Never throws for GitHub: when neither the PR's base nor the default
 * branch can be read, the repository part is null and the reply says so.
 */
import {
  gitProviderFor,
  gitProviderRefOf,
  type GitProviderRef,
} from '@/lib/integrations/git-provider/resolve'
import { logger } from '@/lib/logger'
import { repoConfigService } from '@/ee/security/services/repo-config.service'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import {
  DEFAULT_WORKSPACE_SECURITY_SWITCHES,
  resolveSecurityLayers,
} from '@/ee/security/security-scan/workspace-switches'
import type { PrConfigurationView } from '@/ee/security/security-scan/pr-configuration-reply'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function repoPart(
  input: GitProviderRef & {
    workspaceId: string
    repo: string
    prNumber: number
  }
): Promise<PrConfigurationView['repo']> {
  const { fetchPrBase, fetchDefaultBranchHead } = gitProviderFor(input)
  // Only GitHub reads are caught: the PR's base (what a review applies),
  // else the default branch, said so in the reply; neither → null.
  let at: { ref: string; sha: string; fromDefaultBranch: boolean } | null = null
  try {
    const base = await fetchPrBase({
      workspaceId: input.workspaceId,
      fullName: input.repo,
      prNumber: input.prNumber,
    })
    at = { ...base, fromDefaultBranch: false }
  } catch (error) {
    logger.warn(
      `[pr-configuration] PR base unavailable ${input.repo}#${input.prNumber}: ${describe(error)}`
    )
    try {
      const head = await fetchDefaultBranchHead({
        workspaceId: input.workspaceId,
        fullName: input.repo,
      })
      at = { ref: head.branch, sha: head.sha, fromDefaultBranch: true }
    } catch (fallbackError) {
      logger.warn(
        `[pr-configuration] default branch unavailable ${input.repo}: ${describe(fallbackError)}`
      )
      return null
    }
  }
  // With a sha, effective() reads GitHub only through loadAt, which never
  // throws: a failure here is the database's and propagates (logged, no
  // reply) rather than being reported as a GitHub problem.
  const effective = await repoConfigService.effective({
    ...gitProviderRefOf(input),
    workspaceId: input.workspaceId,
    repo: input.repo,
    sha: at.sha,
  })
  return {
    ...effective,
    ref: at.ref,
    ...(at.fromDefaultBranch ? { fromDefaultBranch: true } : {}),
  }
}

export const prConfigurationService = {
  async forPullRequest(
    input: GitProviderRef & {
      workspaceId: string
      repo: string
      prNumber: number
    }
  ): Promise<PrConfigurationView> {
    const [repo, stored] = await Promise.all([
      repoPart(input),
      securityColumnsRepository.findSecuritySwitches(input.workspaceId),
    ])
    const switches = { ...DEFAULT_WORKSPACE_SECURITY_SWITCHES, ...stored }
    // The `…TurnedOff` flags restate the switches; only what runs is shown.
    const layers = Object.fromEntries(
      Object.entries(
        resolveSecurityLayers(switches, process.env, input.workspaceId)
      ).filter(([name]) => !name.endsWith('TurnedOff'))
    ) as Record<string, boolean>
    return {
      repo,
      switches: { ...switches },
      switchDefaults: { ...DEFAULT_WORKSPACE_SECURITY_SWITCHES },
      layers,
    }
  },
}
