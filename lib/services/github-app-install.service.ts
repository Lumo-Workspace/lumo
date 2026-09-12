import { logger } from '@/lib/logger'
import { githubAppInstallationRepository } from '@/lib/repositories'
import {
  fetchAppInstallation,
  fetchInstallationRepositories,
  deleteAppInstallation,
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
 * Owns the GitHub App installation record: who installed the Lumo App for a
 * workspace and which repositories that installation can reach.
 *
 * Distinct from `githubService`, which owns the OAuth connection (personal
 * token, repo listing, repo webhooks). The two are independent chains: the
 * managed security scan clones with an installation token from here, never with
 * an OAuth token.
 */
export const githubAppInstallService = {
  /** Bind an installation to a workspace (installation callback). */
  async install({ workspaceId, memberId, installationId }: InstallInput) {
    const account = await fetchAppInstallation(installationId)
    const repositories = await fetchInstallationRepositories(installationId)

    return githubAppInstallationRepository.upsert({
      workspaceId,
      installationId,
      accountLogin: account.accountLogin,
      accountType: account.accountType,
      repositories,
      installedBy: memberId,
    })
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
        const { count } =
          await githubAppInstallationRepository.deleteByInstallationId(
            installationId
          )
        logger.info(
          `[github/app] installation ${installationId} ${payload.action}: removed ${count} row(s)`
        )
        return
      }
      case 'created':
      case 'unsuspend':
      case 'new_permissions_accepted': {
        const row =
          await githubAppInstallationRepository.findByInstallationId(
            installationId
          )
        if (!row) {
          logger.info(
            `[github/app] installation ${installationId} ${payload.action} for an unknown workspace; waiting for the setup callback`
          )
          return
        }
        await githubAppInstallationRepository.upsert({
          workspaceId: row.workspaceId,
          installationId,
          accountLogin: payload.installation?.account?.login ?? null,
          accountType: payload.installation?.account?.type ?? null,
          repositories: payload.repositories
            ? fullNames(payload.repositories)
            : row.repositories,
        })
        return
      }
      default:
        return
    }
  },

  /** `installation_repositories` event — repository scope added or removed. */
  async applyInstallationRepositoriesEvent(payload: InstallationEventPayload) {
    const installationId = payload.installation?.id
    if (!installationId) return

    const row =
      await githubAppInstallationRepository.findByInstallationId(installationId)
    if (!row) return

    const removed = new Set(fullNames(payload.repositories_removed))
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
  },
}
