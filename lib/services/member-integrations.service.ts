/**
 * LUM-906 PR2 ruling (b) — when a member is deactivated, their personal
 * integration credentials in THAT workspace go with them: the GitHub OAuth
 * integration (its repo webhooks are deleted on GitHub first, best effort,
 * like the user's own disconnect), Figma, Google Drive and the Feishu
 * account link (LUM-1341). Each disconnect
 * reuses the integration's own service, so it is audited with the existing
 * `*.disconnected` action and the deactivation's actor (OWNER removal →
 * MEMBER, Clerk → WEBHOOK).
 *
 * Scope: every lookup is by (workspaceId, memberId) — the same person's
 * integrations in other workspaces are untouched, and workspace-level
 * installs (Slack, the GitHub App, Sentry) are not member credentials.
 *
 * Idempotent: only integrations that still exist are disconnected (and
 * audited), so a repeat call — a redelivered webhook — does nothing.
 */
import { decrypt } from '@/lib/crypto'
import { deleteRepoWebhook } from '@/lib/integrations/github/webhooks'
import { logger } from '@/lib/logger'
import { figmaIntegrationRepository } from '@/lib/repositories/figma-integration.repository'
import { githubRepository } from '@/lib/repositories/github.repository'
import { googleDriveIntegrationRepository } from '@/lib/repositories/google-drive-integration.repository'
import type { AuditContext } from '@/lib/services/audit.service'
import { disconnectIntegration as disconnectFigma } from '@/lib/services/figma-integration.service'
import { githubService } from '@/lib/services/github.service'
import { disconnectIntegration as disconnectGoogleDrive } from '@/lib/services/google-drive-integration.service'
import {
  removeAccountLink as disconnectFeishuAccount,
  hasAccountLink as hasFeishuAccountLink,
} from '@/lib/services/feishu-integration.service'

export type MemberIntegration =
  | 'github_oauth'
  | 'figma'
  | 'google_drive'
  | 'feishu_account'

/** Best effort: remove the integration's repo webhooks on GitHub. */
async function deleteGithubRepoWebhooks(integration: {
  accessToken: string
  webhooks: Array<{ repo: string; githubHookId: number }>
}) {
  if (integration.webhooks.length === 0) return
  let token: string
  try {
    token = decrypt(integration.accessToken)
  } catch (error) {
    logger.warn('[member-integrations] cannot decrypt GitHub token', {
      error: (error as Error)?.message ?? String(error),
    })
    return
  }
  for (const hook of integration.webhooks) {
    const slash = hook.repo.indexOf('/')
    if (slash <= 0 || slash === hook.repo.length - 1) {
      logger.warn('[member-integrations] skipping malformed repo name', {
        repo: hook.repo,
      })
      continue
    }
    try {
      await deleteRepoWebhook(
        token,
        hook.repo.slice(0, slash),
        hook.repo.slice(slash + 1),
        hook.githubHookId
      )
    } catch (error) {
      logger.warn('[member-integrations] failed to delete repo webhook', {
        repo: hook.repo,
        githubHookId: hook.githubHookId,
        error: (error as Error)?.message ?? String(error),
      })
    }
  }
}

/**
 * Disconnect the member's personal integrations in this workspace. Returns
 * which ones were removed (empty when there was nothing left to remove).
 */
export async function removeMemberIntegrations(
  workspaceId: string,
  memberId: string,
  audit: AuditContext
): Promise<MemberIntegration[]> {
  const removed: MemberIntegration[] = []

  const github = await githubRepository.findIntegrationWithWebhooks(
    workspaceId,
    memberId
  )
  if (github) {
    await deleteGithubRepoWebhooks(github)
    await githubService.deleteIntegration({ id: github.id, workspaceId }, audit)
    removed.push('github_oauth')
  }

  if (await figmaIntegrationRepository.findByMember(workspaceId, memberId)) {
    await disconnectFigma(workspaceId, memberId, audit)
    removed.push('figma')
  }

  if (
    await googleDriveIntegrationRepository.findByMember(workspaceId, memberId)
  ) {
    await disconnectGoogleDrive(workspaceId, memberId, audit)
    removed.push('google_drive')
  }

  if (await hasFeishuAccountLink(workspaceId, memberId)) {
    await disconnectFeishuAccount(workspaceId, memberId, audit)
    removed.push('feishu_account')
  }

  return removed
}

/**
 * removeMemberIntegrations that never throws: a failure is logged (with the
 * ids, for a manual follow-up) and reported as `false`, so it can never stop
 * a deactivation or its API key revocation.
 */
export async function removeMemberIntegrationsSafely(
  workspaceId: string,
  memberId: string,
  audit: AuditContext
): Promise<boolean> {
  try {
    await removeMemberIntegrations(workspaceId, memberId, audit)
    return true
  } catch (error) {
    logger.error('[member-integrations] cleanup failed', {
      workspaceId,
      memberId,
      error: (error as Error)?.message ?? String(error),
    })
    return false
  }
}

export const memberIntegrationsService = {
  removeAll: removeMemberIntegrations,
  removeAllSafely: removeMemberIntegrationsSafely,
}
