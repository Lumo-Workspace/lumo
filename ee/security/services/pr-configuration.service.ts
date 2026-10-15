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
import { logger } from '@/lib/logger'
import { repoConfigService } from '@/ee/security/services/repo-config.service'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'
import {
  DEFAULT_WORKSPACE_SECURITY_SWITCHES,
  resolveSecurityLayers,
} from '@/ee/security/security-scan/workspace-switches'
import type { PrConfigurationView } from '@/ee/security/security-scan/pr-configuration-reply'

async function github() {
  return import('@/lib/integrations/github/contents')
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function repoPart(input: {
  workspaceId: string
  repo: string
  prNumber: number
}): Promise<PrConfigurationView['repo']> {
  try {
    const { fetchPrBase } = await github()
    const base = await fetchPrBase({
      workspaceId: input.workspaceId,
      fullName: input.repo,
      prNumber: input.prNumber,
    })
    const effective = await repoConfigService.effective({
      workspaceId: input.workspaceId,
      repo: input.repo,
      sha: base.sha,
    })
    return { ...effective, ref: base.ref }
  } catch (error) {
    logger.warn(
      `[pr-configuration] PR base unavailable ${input.repo}#${input.prNumber}: ${describe(error)}`
    )
  }
  try {
    // The PR's base could not be read: the default branch is the next best.
    const effective = await repoConfigService.effective({
      workspaceId: input.workspaceId,
      repo: input.repo,
    })
    return { ...effective, fromDefaultBranch: true }
  } catch (error) {
    logger.warn(
      `[pr-configuration] repository config unavailable ${input.repo}: ${describe(error)}`
    )
    return null
  }
}

export const prConfigurationService = {
  async forPullRequest(input: {
    workspaceId: string
    repo: string
    prNumber: number
  }): Promise<PrConfigurationView> {
    const [repo, stored] = await Promise.all([
      repoPart(input),
      securityColumnsRepository.findSecuritySwitches(input.workspaceId),
    ])
    const switches = { ...DEFAULT_WORKSPACE_SECURITY_SWITCHES, ...stored }
    // The `…TurnedOff` flags restate the switches; only what runs is shown.
    const layers = Object.fromEntries(
      Object.entries(resolveSecurityLayers(switches)).filter(
        ([name]) => !name.endsWith('TurnedOff')
      )
    ) as Record<string, boolean>
    return {
      repo,
      switches: { ...switches },
      switchDefaults: { ...DEFAULT_WORKSPACE_SECURITY_SWITCHES },
      layers,
    }
  },
}
