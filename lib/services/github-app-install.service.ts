import { logger } from '@/lib/logger'
import {
  githubAppInstallationRepository,
  prSecurityScanRepository,
} from '@/lib/repositories'
import {
  fetchAppInstallation,
  fetchInstallationRepositories,
  listInstallationRepositories,
  deleteAppInstallation,
  createInstallationToken,
  syncRepoPRs,
} from '@/lib/integrations/github'

interface InstallInput {
  workspaceId: string
  memberId: string
  installationId: number
}

/** `installation` / `installation_repositories` webhook payload, narrowed. */
interface InstallationEventPayload {
  action?: string
  installation?: { id?: number; account?: { login?: string; type?: string } }
  repositories?: { full_name?: string }[]
  repositories_added?: { full_name?: string }[]
  repositories_removed?: { full_name?: string }[]
}

function fullNames(repos: { full_name?: string }[] | undefined): string[] {
  return (repos ?? [])
    .map(r => r.full_name)
    .filter((n): n is string => Boolean(n))
}

/**
 * LUM-855 — uninstalling the App disposes of the customer code Lumo holds for
 * that workspace: security-scan evidence, call chains, hunt audit/job and PR
 * summaries. Scan and finding rows stay so DONE gating and history survive.
 */
async function scrubWorkspaceCode(
  workspaceId: string,
  reason: string,
  repos?: string[]
) {
  const counts = await prSecurityScanRepository.scrubCodeForWorkspace(
    workspaceId,
    repos
  )
  const scope = repos ? ` (${repos.length} repo(s))` : ''
  logger.info(
    `[github/app] workspace ${workspaceId} ${reason}${scope}: scrubbed code from ${counts.scans} scan(s), ${counts.findings} finding(s)`
  )
  return counts
}

/**
 * Owns the GitHub App installation record: who installed the Lumo App for a
 * workspace and which repositories that installation can reach.
 *
 * Distinct from `githubService`, which owns the OAuth connection (personal
 * token, repo listing, repo webhooks). The two are independent chains: the
 * managed security scan clones with an installation token from here, never with
 * an OAuth token.
 */
/**
 * Import the pull requests a repository already has, so PRs opened before Lumo
 * could see the repository still show up on task pages.
 *
 * Best-effort and fire-and-forget: a failed backfill must never fail the
 * installation itself, and the webhook keeps everything current from here on.
 */
async function backfillPullRequests(
  workspaceId: string,
  installationId: number,
  repositories: string[]
): Promise<void> {
  if (repositories.length === 0) return
  try {
    const token = await createInstallationToken(installationId)
    for (const fullName of repositories) {
      await syncRepoPRs(token, fullName, workspaceId, null).catch(error =>
        logger.error(
          `[github/app] PR backfill failed for ${fullName}: ${String(error)}`
        )
      )
    }
  } catch (error) {
    logger.error(
      `[github/app] PR backfill skipped for installation ${installationId}: ${String(error)}`
    )
  }
}

export const githubAppInstallService = {
  /** Bind an installation to a workspace (installation callback). */
  async install({ workspaceId, memberId, installationId }: InstallInput) {
    const account = await fetchAppInstallation(installationId)
    const repositories = await fetchInstallationRepositories(installationId)

    const row = await githubAppInstallationRepository.upsert({
      workspaceId,
      installationId,
      accountLogin: account.accountLogin,
      accountType: account.accountType,
      repositories,
      installedBy: memberId,
    })

    await backfillPullRequests(workspaceId, installationId, repositories)

    return row
  },

  /**
   * Workspace behind an installation id — how a delivery on the App webhook
   * (which carries no repository row of ours) finds its workspace.
   */
  async resolveWorkspaceByInstallation(installationId: number) {
    const row =
      await githubAppInstallationRepository.findByInstallationId(installationId)
    return row?.workspaceId ?? null
  },

  /**
   * Live repository list for pickers. `null` when the App is not installed —
   * the route turns that into the 404 `useGithubRepos` treats as "not connected".
   */
  async listRepositories(workspaceId: string) {
    const row =
      await githubAppInstallationRepository.findByWorkspace(workspaceId)
    if (!row) return null
    return listInstallationRepositories(row.installationId)
  },

  /** Installation status for the settings card. */
  async getStatus(workspaceId: string) {
    const row =
      await githubAppInstallationRepository.findStatusByWorkspace(workspaceId)
    if (!row) return { installed: false } as const
    return {
      installed: true,
      accountLogin: row.accountLogin,
      accountType: row.accountType,
      repositories: row.repositories,
    } as const
  },

  /**
   * Uninstall the App for this workspace. Owner-only: the installation is a
   * shared workspace asset — removing it turns off managed security scanning
   * for the whole team — so it follows the same rule as disconnecting Slack,
   * not the OAuth disconnect (which only drops the caller's own token).
   *
   * The GitHub-side delete is best-effort — our row goes either way, so the
   * card can never get stuck.
   */
  async uninstall(workspaceId: string, memberRole: string) {
    if (memberRole !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can uninstall the GitHub App'),
        { status: 403 }
      )
    }

    const row =
      await githubAppInstallationRepository.findByWorkspace(workspaceId)
    if (!row) return { removed: false } as const

    try {
      await deleteAppInstallation(row.installationId)
    } catch (error) {
      logger.error(
        `[github/app] failed to delete installation ${row.installationId} on GitHub: ${String(error)}`
      )
    }
    await githubAppInstallationRepository.delete(workspaceId)
    await scrubWorkspaceCode(workspaceId, 'uninstalled from Lumo')
    return { removed: true } as const
  },

  /**
   * `installation` event. Attribution is by installation id — the payload has
   * no repository, so there is nothing else to key on, and an id we have never
   * seen belongs to a workspace that has not run the callback: ignore it rather
   * than guessing a workspace.
   *
   * `suspend` removes the row like `deleted` does: a suspended installation
   * cannot clone, and a card that still claims the App is installed is exactly
   * the lie this flow exists to remove. Re-installing (or unsuspending and
   * re-running the callback) writes it back.
   */
  async applyInstallationEvent(payload: InstallationEventPayload) {
    const installationId = payload.installation?.id
    if (!installationId) return

    switch (payload.action) {
      case 'deleted':
      case 'suspend': {
        // Resolve the workspaces before the rows go — the payload carries
        // none, and one installation can back several workspaces (LUM-872).
        const owners =
          payload.action === 'deleted'
            ? await githubAppInstallationRepository.findAllByInstallationId(
                installationId
              )
            : []
        const { count } =
          await githubAppInstallationRepository.deleteByInstallationId(
            installationId
          )
        logger.info(
          `[github/app] installation ${installationId} ${payload.action}: removed ${count} row(s)`
        )
        // Suspend is reversible (unsuspend restores the App), so only a real
        // uninstall scrubs the workspace's code.
        for (const owner of owners) {
          await scrubWorkspaceCode(owner.workspaceId, 'uninstalled on GitHub')
        }
        return
      }
      case 'created':
      case 'unsuspend':
      case 'new_permissions_accepted': {
        const rows =
          await githubAppInstallationRepository.findAllByInstallationId(
            installationId
          )
        if (rows.length === 0) {
          logger.info(
            `[github/app] installation ${installationId} ${payload.action} for an unknown workspace; waiting for the setup callback`
          )
          return
        }
        for (const row of rows) {
          await githubAppInstallationRepository.upsert({
            workspaceId: row.workspaceId,
            installationId,
            accountLogin: payload.installation?.account?.login ?? null,
            accountType: payload.installation?.account?.type ?? null,
            repositories: payload.repositories
              ? fullNames(payload.repositories)
              : row.repositories,
          })
        }
        return
      }
      default:
        return
    }
  },

  /**
   * `installation_repositories` event — repository scope added or removed,
   * applied to every workspace bound to the installation. A repository the
   * App can no longer reach has its scan code scrubbed like an uninstall
   * (LUM-872): Lumo keeps no customer code it has lost access to.
   */
  async applyInstallationRepositoriesEvent(payload: InstallationEventPayload) {
    const installationId = payload.installation?.id
    if (!installationId) return

    const rows =
      await githubAppInstallationRepository.findAllByInstallationId(
        installationId
      )
    const removedNames = fullNames(payload.repositories_removed)
    const removed = new Set(removedNames)

    for (const row of rows) {
      const next = [
        ...new Set([
          ...row.repositories,
          ...fullNames(payload.repositories_added),
        ]),
      ].filter(name => !removed.has(name))

      await githubAppInstallationRepository.updateRepositories(
        row.workspaceId,
        next
      )

      if (removedNames.length > 0) {
        await scrubWorkspaceCode(
          row.workspaceId,
          'repository removed from the installation',
          removedNames
        )
      }

      const added = fullNames(payload.repositories_added).filter(
        name => !row.repositories.includes(name)
      )
      await backfillPullRequests(row.workspaceId, installationId, added)
    }
  },
}
