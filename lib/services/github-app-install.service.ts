import { logger } from '@/lib/logger'
import {
  recordAuditEvent,
  SYSTEM_AUDIT_CONTEXT,
  WEBHOOK_AUDIT_CONTEXT,
  type AuditContext,
} from '@/lib/services/audit.service'
import { githubService } from '@/lib/services/github.service'
import { TOKEN_FAILING_ALERT_MS } from '@/lib/services/github-access-recheck.config'
import {
  githubAppInstallationRepository,
  prSecurityScanRepository,
} from '@/lib/repositories'
import {
  fetchAppInstallation,
  fetchInstallationRepositories,
  listInstallationRepositories,
  deleteAppInstallation,
  getRepoToken,
  REPO_TOKEN_PERMISSIONS,
  listRecentPullRequests,
  buildAppUserAuthorizeUrl,
  exchangeAppUserCode,
  listUserInstallationIds,
  listUserInstallationRepositories,
  fetchAppUser,
  revokeAppUserToken,
  GithubAppUserAuthNotConfiguredError,
} from '@/lib/integrations/github'
import { canonicalConfirmedRepository } from '@/lib/integrations/github/confirmed-repositories'
import { scrubMirroredCommentCode } from '@/lib/services/pr-comment-code-scrub.service'

interface InstallInput {
  workspaceId: string
  memberId: string
  installationId: number
  /** GitHub App user-authorization code from the install callback (LUM-875). */
  userCode: string
  /** The redirect_uri the code was issued for — GitHub re-checks it. */
  redirectUri: string
  /** LUM-907: who installed, from where. */
  audit?: AuditContext
}

/** `installation` / `installation_repositories` webhook payload, narrowed. */
interface InstallationEventPayload {
  action?: string
  installation?: { id?: number; account?: { login?: string; type?: string } }
  repositories?: { full_name?: string }[]
  repositories_added?: { full_name?: string }[]
  repositories_removed?: { full_name?: string }[]
}

interface ReverifyInput {
  workspaceId: string
  memberRole: string
  userCode: string
  redirectUri: string
  /** LUM-907: who re-verified, from where. */
  audit?: AuditContext
}

function fullNames(repos: { full_name?: string }[] | undefined): string[] {
  return (repos ?? [])
    .map(r => r.full_name)
    .filter((n): n is string => Boolean(n))
}

/** GitHub repository names are case-insensitive. */
function lowerSet(names: string[]): Set<string> {
  return new Set(names.map(name => name.toLowerCase()))
}

function without(names: string[], exclude: Set<string>): string[] {
  return names.filter(name => !exclude.has(name.toLowerCase()))
}

/**
 * LUM-855 — uninstalling the App disposes of the customer code Lumo holds for
 * that workspace: security-scan evidence, call chains, hunt audit/job and PR
 * summaries. Scan and finding rows stay so DONE gating and history survive.
 */
export async function scrubWorkspaceCode(
  workspaceId: string,
  reason: string,
  repos?: string[]
) {
  const counts = await prSecurityScanRepository.scrubCodeForWorkspace(
    workspaceId,
    repos
  )
  // LUM-879 — and the code in comments mirrored from those repositories'
  // PRs, with the sync jobs still holding GitHub's raw payload.
  const mirrored = await scrubMirroredCommentCode(workspaceId, reason, repos)
  const scope = repos ? ` (${repos.length} repo(s))` : ''
  logger.info(
    `[github/app] workspace ${workspaceId} ${reason}${scope}: scrubbed code from ${counts.scans} scan(s), ${counts.findings} finding(s), ${mirrored.comments} mirrored comment(s); retired ${mirrored.jobs} sync job(s)`
  )
  return counts
}

/**
 * LUM-895 — the second half of "scrub, then narrow": a scan that wrote code
 * for one of `repos` between the first scrub and the narrowing write would
 * otherwise be left behind for a repository no longer on the list. Best
 * effort — the list has already narrowed, so a failure here is logged, not
 * thrown back into a result that was written.
 */
export async function scrubAfterNarrowing(
  workspaceId: string,
  reason: string,
  /** `undefined` — the whole workspace (LUM-902: an unbind). */
  repos?: string[]
) {
  if (repos?.length === 0) return
  try {
    await scrubWorkspaceCode(workspaceId, `${reason} (after narrowing)`, repos)
  } catch (error) {
    logger.error(
      `[github/app] workspace ${workspaceId}: scrub after narrowing failed: ${String(error)}`
    )
  }
}

/**
 * Narrow a workspace's confirmed list the one safe way (LUM-888, LUM-895):
 * scrub the dropped repositories first — a scrub that throws writes nothing,
 * so the repositories stay confirmed and the daily recheck (which finds them
 * unreadable) retries — then write, then scrub again for anything written in
 * between.
 */
async function narrowWithScrub<T>(
  workspaceId: string,
  gone: string[],
  reason: string,
  write: () => Promise<T>
): Promise<T> {
  if (gone.length > 0) await scrubWorkspaceCode(workspaceId, reason, gone)
  const result = await write()
  await scrubAfterNarrowing(workspaceId, reason, gone)
  return result
}

/**
 * LUM-902 — a webhook event that failed for some of its workspaces still
 * fails as a whole, but only after every workspace had its turn. The route
 * logs it and answers 200 — GitHub does not redeliver failed deliveries on
 * its own — and the daily access recheck retries what was left (see the
 * catch in `app/api/webhooks/github/route.ts`).
 */
function throwIfAnyFailed(installationId: number, failed: number) {
  if (failed > 0) {
    throw new Error(
      `installation ${installationId}: ${failed} workspace(s) failed; see the log above`
    )
  }
}

/**
 * LUM-902 — unbind one workspace the same safe way: scrub its code first — a
 * scrub that throws deletes nothing, so the row is still there for a retry
 * (or the daily recheck) to find — then delete the row, then scrub again for
 * anything a scan wrote in between.
 */
async function unbindWithScrub(
  workspaceId: string,
  reason: string,
  installationId?: number
) {
  await scrubWorkspaceCode(workspaceId, reason)
  await githubAppInstallationRepository.deleteForWorkspace(
    workspaceId,
    installationId
  )
  await scrubAfterNarrowing(workspaceId, reason)
}

/**
 * LUM-902 — an installation is gone (or suspended) on GitHub: unbind every
 * workspace it backs (LUM-872) and dispose of their code. One workspace whose
 * scrub throws keeps its row and does not stop the others; the caller gets
 * the counts, and the daily recheck retries what is left.
 */
export async function removeInstallation(
  installationId: number,
  reason: string,
  audit: { kind: 'deleted' | 'suspend'; context: AuditContext } = {
    kind: 'deleted',
    context: SYSTEM_AUDIT_CONTEXT,
  }
): Promise<{ removed: number; failed: number }> {
  const owners =
    await githubAppInstallationRepository.findAllByInstallationId(
      installationId
    )
  let removed = 0
  let failed = 0
  for (const owner of owners) {
    try {
      await unbindWithScrub(owner.workspaceId, reason, installationId)
      removed++
      // LUM-907: nobody in the workspace did this — GitHub told us (webhook)
      // or the daily recheck found it (SYSTEM). Recorded per workspace, only
      // once the unbind went through.
      await recordAuditEvent({
        workspaceId: owner.workspaceId,
        action:
          audit.kind === 'suspend'
            ? 'github_app.suspended'
            : 'github_app.uninstalled',
        target: { type: 'integration', id: 'github' },
        metadata: { installationId, reason },
        context: audit.context,
      })
    } catch (error) {
      failed++
      logger.error(
        `[github/app] installation ${installationId}: could not unbind workspace ${owner.workspaceId}; row kept for a retry: ${String(error)}`
      )
    }
  }
  logger.info(
    `[github/app] installation ${installationId} ${reason}: unbound ${removed} workspace(s), ${failed} failed`
  )
  return { removed, failed }
}

/**
 * LUM-875 — the install callback's `installation_id` is untrusted input: the
 * App can read every installation it has, so the only thing that ties an
 * installation to the person installing is GitHub's answer to "which of our
 * installations can this user access". Anything short of a clear yes throws —
 * missing client credentials, a bad code, a GitHub error — so the caller
 * writes nothing.
 *
 * LUM-880 — "can access" only means the user can read *one* of the
 * installation's repositories, so this also returns the repositories the user
 * can read; `install()` refuses unless they cover the whole installation.
 *
 * LUM-882 — also returns the user's GitHub login, so the daily access recheck
 * can ask about this verifier later with the installation token alone.
 * LUM-888 — and the account's immutable id, which the recheck follows.
 */
async function listRepositoriesUserCanRead(
  userCode: string,
  redirectUri: string,
  installationId: number
): Promise<{ login: string; githubId: number; repositories: string[] }> {
  let userToken: string
  try {
    userToken = await exchangeAppUserCode(userCode, redirectUri)
  } catch (error) {
    if (error instanceof GithubAppUserAuthNotConfiguredError) {
      throw Object.assign(error, { status: 503, code: 'verify_not_configured' })
    }
    throw error
  }
  try {
    const ids = await listUserInstallationIds(userToken)
    if (!ids.includes(installationId)) {
      throw Object.assign(
        new Error(
          `The signed-in GitHub user cannot access installation ${installationId}`
        ),
        { status: 403, code: 'not_authorized' }
      )
    }
    const [user, repositories] = await Promise.all([
      fetchAppUser(userToken),
      listUserInstallationRepositories(userToken, installationId),
    ])
    return { login: user.login, githubId: user.id, repositories }
  } finally {
    await revokeAppUserToken(userToken)
  }
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
 *
 * LUM-890: runs after the confirmed list is written, so each repository gets
 * its own `pull_requests: read` token through `getRepoToken` — the same
 * confirmed-list check and permission set as every other PR read — rather
 * than one installation-wide token for all of them.
 */
async function backfillPullRequests(
  workspaceId: string,
  repositories: string[]
): Promise<void> {
  for (const fullName of repositories) {
    try {
      const token = await getRepoToken(
        workspaceId,
        fullName,
        REPO_TOKEN_PERMISSIONS.pullRequestRead
      )
      const prs = await listRecentPullRequests(token, fullName)
      // LUM-929: linked through the same ambiguity-checked lookup as the
      // webhook, so a repository another workspace shares is not linked to
      // whichever same-numbered task this workspace happens to hold.
      await githubService.backfillPullRequests(workspaceId, fullName, prs)
    } catch (error) {
      logger.error(
        `[github/app] PR backfill failed for ${fullName}: ${String(error)}`
      )
    }
  }
}

/**
 * Re-verification narrows what the whole team sees, so it follows the
 * uninstall rule: workspace owners only (LUM-881).
 */
async function requireReverifiableInstallation(
  workspaceId: string,
  memberRole: string
) {
  if (memberRole !== 'OWNER') {
    throw Object.assign(
      new Error('Only workspace owners can re-verify the GitHub App'),
      { status: 403, code: 'not_owner' }
    )
  }
  const row =
    await githubAppInstallationRepository.findStatusByWorkspace(workspaceId)
  if (!row) {
    throw Object.assign(new Error('GitHub App not installed'), {
      status: 404,
      code: 'not_installed',
    })
  }
  return row
}

/**
 * `installation_repositories` removal for one workspace (LUM-895): scrub
 * first, as every narrowing does — the stored spelling (what the scans carry)
 * and the payload's.
 */
async function narrowRemovedRepositories(
  row: { workspaceId: string; repositories: string[] },
  removed: Set<string>,
  removedNames: string[],
  reason = 'repository removed from the installation'
) {
  if (removedNames.length === 0) return
  const kept = without(row.repositories, removed)
  const gone = row.repositories.filter(name => removed.has(name.toLowerCase()))
  await narrowWithScrub(
    row.workspaceId,
    [...new Set([...gone, ...removedNames])],
    reason,
    () =>
      githubAppInstallationRepository.updateRepositories(row.workspaceId, kept)
  )
}

/** A concurrent write to the row: re-read and retry once. */
const RENAME_ATTEMPTS = 2

/**
 * LUM-879 — one workspace's half of a rename. The list is rewritten from the
 * row as read: `from` (in the list's own spelling) becomes `to`, GitHub's
 * canonical new name (LUM-889), and a second spelling of `to` is dropped.
 */
async function renameForWorkspace(
  workspaceId: string,
  from: string,
  to: string
) {
  for (let attempt = 0; attempt < RENAME_ATTEMPTS; attempt++) {
    const state =
      await githubAppInstallationRepository.findRecheckState(workspaceId)
    if (!state) return
    const stored = canonicalConfirmedRepository(state.repositories, from)
    if (stored === null) return
    const target = to.toLowerCase()
    const repositories = state.repositories.flatMap(name => {
      if (name === stored) return [to]
      return name.toLowerCase() === target ? [] : [name]
    })
    const result = await githubAppInstallationRepository.renameRepository(
      workspaceId,
      {
        expectedUpdatedAt: state.updatedAt,
        repositories,
        from: stored,
        to,
      }
    )
    if (result) {
      logger.info(
        `[github/app] workspace ${workspaceId}: ${stored} renamed to ${to}; moved ${result.pullRequests} PR(s)${result.skipped > 0 ? `, ${result.skipped} row(s) kept under the old name (already present under the new one)` : ''}`
      )
      return
    }
  }
  throw new Error(
    `workspace ${workspaceId}: the confirmed list kept changing during the rename`
  )
}

export const githubAppInstallService = {
  /**
   * Where the setup callback sends the user so GitHub can tell us who they are
   * (LUM-875). Throws a 503 `not_configured` when the App client credentials
   * are missing — an install that cannot be verified must not proceed.
   */
  userAuthorizeUrl(state: string, redirectUri: string) {
    try {
      return buildAppUserAuthorizeUrl(state, redirectUri)
    } catch (error) {
      if (error instanceof GithubAppUserAuthNotConfiguredError) {
        throw Object.assign(error, {
          status: 503,
          code: 'verify_not_configured',
        })
      }
      throw error
    }
  },

  /**
   * Bind an installation to a workspace (installation callback). Nothing is
   * read with the App's identity — let alone written — until GitHub confirms
   * the caller can access the installation (LUM-875).
   *
   * The whole installation lands in the workspace — its PRs, managed scans and
   * picker — so the caller must be able to read every repository in it
   * (LUM-880). An org admin always can; a member who reads only some of the
   * org's repositories cannot bind it, or their workspace would show them
   * repositories GitHub hides from them.
   */
  async install({
    workspaceId,
    memberId,
    installationId,
    userCode,
    redirectUri,
    audit,
  }: InstallInput) {
    const {
      login,
      githubId,
      repositories: readable,
    } = await listRepositoriesUserCanRead(userCode, redirectUri, installationId)

    const account = await fetchAppInstallation(installationId)
    const repositories = await fetchInstallationRepositories(installationId)

    // GitHub repository names are case-insensitive.
    const readableSet = new Set(readable.map(name => name.toLowerCase()))
    const hidden = repositories.filter(
      name => !readableSet.has(name.toLowerCase())
    )
    if (hidden.length > 0) {
      throw Object.assign(
        new Error(
          `The signed-in GitHub user cannot read ${hidden.length} of ${repositories.length} repositories in installation ${installationId}`
        ),
        { status: 403, code: 'repo_access_incomplete' }
      )
    }

    // LUM-902 — re-running the callback on a bound workspace (the same
    // installation after a missed webhook, or another one) replaces the
    // list: what drops out of it is scrubbed first, like every narrowing.
    const previous =
      await githubAppInstallationRepository.findByWorkspace(workspaceId)
    const gone = previous
      ? without(previous.repositories, lowerSet(repositories))
      : []
    const row = await narrowWithScrub(
      workspaceId,
      gone,
      'repository not in the re-installed installation',
      () =>
        githubAppInstallationRepository.upsert({
          workspaceId,
          installationId,
          accountLogin: account.accountLogin,
          accountType: account.accountType,
          repositories,
          installedBy: memberId,
          verifier: { login, githubId },
        })
    )

    await recordAuditEvent({
      workspaceId,
      action: 'github_app.installed',
      target: { type: 'integration', id: 'github' },
      metadata: {
        installationId,
        accountLogin: account.accountLogin,
        repositoryCount: repositories.length,
        reinstall: previous !== null,
      },
      context: audit,
    })
    await backfillPullRequests(workspaceId, repositories)

    return row
  },

  /**
   * Gate for starting a re-verification: owner-only, and only with an
   * installation to re-check. Returns the installation id the state carries.
   */
  async startReverify(workspaceId: string, memberRole: string) {
    const row = await requireReverifiableInstallation(workspaceId, memberRole)
    return row.installationId
  },

  /**
   * Re-check the installation against what a workspace owner can read on
   * GitHub now (LUM-881). The row's `repositories` is the workspace's
   * *confirmed* list — only repositories someone with read access vouched for
   * reach the workspace. This recomputes it as the installation's current
   * repositories that the verifier can read: repositories added after binding
   * are enabled (and backfilled), ones the verifier has lost are removed and
   * their scan code scrubbed. The user token is revoked right after the check;
   * only the verifier's login (an identifier, LUM-882) is kept.
   */
  async reverify({
    workspaceId,
    memberRole,
    userCode,
    redirectUri,
    audit,
  }: ReverifyInput) {
    const row = await requireReverifiableInstallation(workspaceId, memberRole)

    const verifier = await listRepositoriesUserCanRead(
      userCode,
      redirectUri,
      row.installationId
    )
    const readable = lowerSet(verifier.repositories)
    const live = await fetchInstallationRepositories(row.installationId)

    const confirmed = live.filter(name => readable.has(name.toLowerCase()))
    const confirmedSet = lowerSet(confirmed)
    const previousSet = lowerSet(row.repositories)
    const added = without(confirmed, previousSet)
    const removed = without(row.repositories, confirmedSet)

    // LUM-888 — scrub before the list narrows: a scrub that throws leaves
    // the repositories confirmed, so retrying the re-verification scrubs
    // them, instead of orphaning code no recheck will look at again.
    // LUM-882 — the daily access recheck follows this verifier from now on.
    await narrowWithScrub(
      workspaceId,
      removed,
      'repository no longer readable by the verifier',
      () =>
        githubAppInstallationRepository.recordVerification(
          workspaceId,
          confirmed,
          { login: verifier.login, githubId: verifier.githubId }
        )
    )
    await recordAuditEvent({
      workspaceId,
      action: 'github_app.reverified',
      target: { type: 'integration', id: 'github' },
      metadata: {
        installationId: row.installationId,
        confirmed: confirmed.length,
        added: added.length,
        removed: removed.length,
      },
      context: audit,
    })
    await backfillPullRequests(workspaceId, added)

    return { confirmed: confirmed.length, added, removed }
  },

  /**
   * Workspaces that an App-delivered repository event belongs to. An
   * installation id alone is not enough: the event must be for a repository
   * the workspace has confirmed (LUM-881), or a repository added to the
   * installation later would flow into the workspace unchecked.
   *
   * LUM-924: several workspaces can share one installation (LUM-872) and each
   * confirm the same repository — every one of them gets the event, in
   * installation order. An empty list drops the delivery.
   */
  async resolveWorkspacesForRepository(
    installationId: number,
    repositoryFullName: string | null
  ): Promise<string[]> {
    if (!repositoryFullName) return []
    const target = repositoryFullName.toLowerCase()
    const rows =
      await githubAppInstallationRepository.findAllByInstallationId(
        installationId
      )
    return rows
      .filter(r => r.repositories.some(name => name.toLowerCase() === target))
      .map(r => r.workspaceId)
  },

  /**
   * LUM-884 — whether a legacy OAuth repo-hook delivery may be handled for
   * this workspace. The same confirmed list bounds the OAuth hook as the App
   * webhook: a workspace without the App has no list, so nothing it receives
   * over the old hook is routed either.
   */
  async isRepositoryConfirmed(workspaceId: string, repositoryFullName: string) {
    const row =
      await githubAppInstallationRepository.findByWorkspace(workspaceId)
    if (!row) return false
    return lowerSet(row.repositories).has(repositoryFullName.toLowerCase())
  },

  /**
   * Confirmed repositories for pickers, filtered through the live list so a
   * repository the App has since lost does not show. `null` when the App is
   * not installed — the route turns that into the 404 `useGithubRepos` treats
   * as "not connected".
   */
  async listRepositories(workspaceId: string) {
    const row =
      await githubAppInstallationRepository.findStatusByWorkspace(workspaceId)
    if (!row) return null
    const confirmed = lowerSet(row.repositories)
    const live = await listInstallationRepositories(row.installationId)
    return live.filter(r => confirmed.has(r.fullName.toLowerCase()))
  },

  /**
   * Installation status for the settings card. `pendingRepositories` are the
   * ones the installation reaches but the workspace has not confirmed —
   * `null` when the live list cannot be read (GitHub error, over the listing
   * cap), so the card never claims there is nothing pending when it does not
   * know.
   *
   * LUM-883: owners only. The names of repositories nobody has confirmed are
   * exactly what the workspace has not agreed to share; other members get the
   * status without the key (and without the GitHub listing call).
   */
  async getStatus(workspaceId: string, memberRole: string) {
    const row =
      await githubAppInstallationRepository.findStatusByWorkspace(workspaceId)
    if (!row) return { installed: false } as const

    let pending: { pendingRepositories: string[] | null } | undefined
    if (memberRole === 'OWNER') {
      try {
        const live = await fetchInstallationRepositories(row.installationId)
        pending = {
          pendingRepositories: without(live, lowerSet(row.repositories)),
        }
      } catch (error) {
        logger.error(
          `[github/app] cannot list installation ${row.installationId} for pending repositories: ${String(error)}`
        )
        pending = { pendingRepositories: null }
      }
    }

    return {
      installed: true,
      accountLogin: row.accountLogin,
      accountType: row.accountType,
      repositories: row.repositories,
      ...pending,
      // LUM-882 — no verifier on record (bound before LUM-882): the daily
      // recheck skips this installation until an owner re-verifies once.
      accessRecheckEnabled: row.verifierLogin !== null,
      accessRemovedCount: row.accessRemovedCount,
      accessRemovedAt: row.accessRemovedAt?.toISOString() ?? null,
      accessRemovedReason: row.accessRemovedReason,
      // LUM-927 — set only once the failure run has passed the alert
      // threshold: a token that fails for a day is GitHub having a bad day.
      tokenFailingSince:
        row.tokenFailingSince &&
        Date.now() - row.tokenFailingSince.getTime() >= TOKEN_FAILING_ALERT_MS
          ? row.tokenFailingSince.toISOString()
          : null,
    } as const
  },

  /**
   * Uninstall the App for this workspace. Owner-only: the installation is a
   * shared workspace asset — removing it turns off managed security scanning
   * for the whole team — so it follows the same rule as disconnecting Slack,
   * not the OAuth disconnect (which only drops the caller's own token).
   *
   * The GitHub-side delete is best-effort — our row goes either way, so the
   * card can never get stuck. It is skipped while another workspace is still
   * bound to the same installation (LUM-872 sharing): removing the App on
   * GitHub would silently switch scanning off for that workspace too (LUM-875).
   *
   * LUM-902 — the code is scrubbed before anything is removed: a scrub that
   * throws fails the request with the row (and the App) still in place, so
   * the owner can retry instead of leaving code no workspace points at.
   */
  async uninstall(
    workspaceId: string,
    memberRole: string,
    audit?: AuditContext
  ) {
    if (memberRole !== 'OWNER') {
      throw Object.assign(
        new Error('Only workspace owners can uninstall the GitHub App'),
        { status: 403 }
      )
    }

    const row =
      await githubAppInstallationRepository.findByWorkspace(workspaceId)
    if (!row) return { removed: false } as const

    await scrubWorkspaceCode(workspaceId, 'uninstalled from Lumo')

    const bound = await githubAppInstallationRepository.findAllByInstallationId(
      row.installationId
    )
    const shared = bound.some(b => b.workspaceId !== workspaceId)
    if (shared) {
      logger.info(
        `[github/app] installation ${row.installationId} is shared with another workspace; unbinding ${workspaceId} only`
      )
    } else {
      try {
        await deleteAppInstallation(row.installationId)
      } catch (error) {
        logger.error(
          `[github/app] failed to delete installation ${row.installationId} on GitHub: ${String(error)}`
        )
      }
    }
    await githubAppInstallationRepository.deleteForWorkspace(workspaceId)
    await recordAuditEvent({
      workspaceId,
      action: 'github_app.uninstalled',
      target: { type: 'integration', id: 'github' },
      metadata: { installationId: row.installationId, shared },
      context: audit,
    })
    await scrubAfterNarrowing(workspaceId, 'uninstalled from Lumo')
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
   *
   * LUM-902 — and scrubs like it too: the row is what keeps code "confirmed",
   * so code left behind by a suspend would be held for a repository no list
   * names. Scan and finding rows (and dispositions) survive, as on uninstall.
   */
  async applyInstallationEvent(payload: InstallationEventPayload) {
    const installationId = payload.installation?.id
    if (!installationId) return

    switch (payload.action) {
      case 'deleted':
      case 'suspend': {
        const { failed } = await removeInstallation(
          installationId,
          payload.action === 'deleted'
            ? 'uninstalled on GitHub'
            : 'suspended on GitHub',
          { kind: payload.action, context: WEBHOOK_AUDIT_CONTEXT }
        )
        throwIfAnyFailed(installationId, failed)
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
        // The payload's list can only narrow the confirmed one: a repository
        // it adds has not been vouched for by anyone who can read it (LUM-881).
        // One it no longer has is dropped with its scan code (LUM-895).
        const reachable = payload.repositories
          ? lowerSet(fullNames(payload.repositories))
          : null
        let failed = 0
        for (const row of rows) {
          const gone = reachable
            ? row.repositories.filter(
                name => !reachable.has(name.toLowerCase())
              )
            : []
          // LUM-902 — one workspace failing does not stop the others.
          try {
            await narrowWithScrub(
              row.workspaceId,
              gone,
              'repository no longer in the installation',
              () =>
                githubAppInstallationRepository.upsert({
                  workspaceId: row.workspaceId,
                  installationId,
                  accountLogin: payload.installation?.account?.login ?? null,
                  accountType: payload.installation?.account?.type ?? null,
                  repositories: without(row.repositories, lowerSet(gone)),
                })
            )
          } catch (error) {
            failed++
            logger.error(
              `[github/app] installation ${installationId} ${payload.action}: workspace ${row.workspaceId} failed; list kept: ${String(error)}`
            )
          }
        }
        throwIfAnyFailed(installationId, failed)
        return
      }
      default:
        return
    }
  },

  /**
   * `installation_repositories` event, applied to every workspace bound to the
   * installation. A repository the App can no longer reach leaves the
   * confirmed list and has its scan code scrubbed like an uninstall (LUM-872):
   * Lumo keeps no customer code it has lost access to.
   *
   * An added repository is *not* confirmed (LUM-881): the webhook carries no
   * user, so nobody has shown they can read it. It stays pending — no event
   * routing, no backfill, not in pickers — until an owner re-verifies.
   */
  async applyInstallationRepositoriesEvent(payload: InstallationEventPayload) {
    const installationId = payload.installation?.id
    if (!installationId) return

    const rows =
      await githubAppInstallationRepository.findAllByInstallationId(
        installationId
      )
    const removedNames = fullNames(payload.repositories_removed)
    const removed = lowerSet(removedNames)
    const addedCount = fullNames(payload.repositories_added).length

    // LUM-902 — one workspace whose scrub throws keeps its list and does
    // not stop the others. LUM-927 — the daily access recheck narrows every
    // row to the installation's live repositories, which retries it.
    let failed = 0
    for (const row of rows) {
      try {
        await narrowRemovedRepositories(row, removed, removedNames)
      } catch (error) {
        failed++
        logger.error(
          `[github/app] installation ${installationId}: narrowing workspace ${row.workspaceId} failed; list kept: ${String(error)}`
        )
      }
      if (addedCount > 0) {
        logger.info(
          `[github/app] installation ${installationId}: ${addedCount} repository(ies) added; pending re-verification for workspace ${row.workspaceId}`
        )
      }
    }
    throwIfAnyFailed(installationId, failed)
  },

  /**
   * LUM-879 — `repository` `renamed`: the confirmed list, the PR rows and
   * every other stored `owner/name` of each workspace that confirmed `from`
   * move to `to` together (`renameRepository`), so the token mint, event
   * routing, SARIF ingest and the scans' post-write check all keep working
   * under the new name. A workspace that did not confirm `from` is left
   * alone; a lost write race is re-read and retried once. When the event is
   * lost, the daily recheck finds `from` gone from the installation and
   * drops it with its code (LUM-927) — fail closed, re-verify restores it.
   */
  async renameRepository(installationId: number, from: string, to: string) {
    const rows =
      await githubAppInstallationRepository.findAllByInstallationId(
        installationId
      )
    let failed = 0
    for (const row of rows) {
      try {
        await renameForWorkspace(row.workspaceId, from, to)
      } catch (error) {
        failed++
        logger.error(
          `[github/app] installation ${installationId}: renaming ${from} → ${to} failed for workspace ${row.workspaceId}: ${String(error)}`
        )
      }
    }
    throwIfAnyFailed(installationId, failed)
  },

  /**
   * LUM-879 — a repository left GitHub's reach without the installation
   * event that would say so: `deleted`, or `transferred` to another owner
   * (whose installation, if any, is another one). Every workspace that
   * confirmed one of `names` narrows like an `installation_repositories`
   * removal — scrub (scans, mirrored comments, sync payloads), write, scrub
   * again. `installationId` limits it to that installation's workspaces;
   * omitted, every workspace is looked at (a transfer event may come from
   * either side).
   */
  async removeRepository(
    names: string[],
    reason: string,
    installationId?: number
  ) {
    const rows =
      installationId !== undefined
        ? await githubAppInstallationRepository.findAllByInstallationId(
            installationId
          )
        : await githubAppInstallationRepository.findAllForInstallationNarrowing()
    const removed = lowerSet(names)
    let failed = 0
    for (const row of rows) {
      if (!row.repositories.some(name => removed.has(name.toLowerCase())))
        continue
      try {
        await narrowRemovedRepositories(row, removed, names, reason)
      } catch (error) {
        failed++
        logger.error(
          `[github/app] ${reason}: narrowing workspace ${row.workspaceId} failed; list kept: ${String(error)}`
        )
      }
    }
    if (failed > 0) {
      throw new Error(
        `${reason}: ${failed} workspace(s) failed; see the log above`
      )
    }
  },
}
