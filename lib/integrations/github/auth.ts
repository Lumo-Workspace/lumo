import { logger } from '@/lib/logger'
import { createAppAuth } from '@octokit/auth-app'
import { requireConfirmedRepository } from './confirmed-repositories'

/**
 * Installation tokens for the Lumo Agent app.
 *
 * App credentials (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY) stay in env — one
 * Lumo App, many installations. The installationId is resolved per-workspace
 * from GitHubAppInstallation, written by the installation callback
 * (/api/github/app/setup) and the App-level `installation` webhook.
 *
 * LUM-852: there is no fallback. A workspace with no row (or a call with no
 * workspaceId) used to borrow the global GITHUB_APP_INSTALLATION_ID — Lumo's
 * own installation — which pointed another tenant's clone at repositories
 * Lumo owns. Not having installed the App is an answer, not a warning.
 *
 * LUM-883: there is no workspace-wide token either. Every mint names ONE
 * repository and is refused unless that repository is on the workspace's
 * confirmed list, so a PR URL, a project repository setting or a stale
 * PullRequest row can no longer pull in a repository the installation reaches
 * but the workspace never confirmed.
 */
async function resolveConfirmedInstallation(
  workspaceId: string,
  repository: string
): Promise<number> {
  try {
    const { installationId } = await requireConfirmedRepository(
      workspaceId,
      repository
    )
    return installationId
  } catch (error) {
    logger.warn(
      `[github/auth] refused a token for ${repository} in workspace ${workspaceId}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    throw error
  }
}

/**
 * App credentials from env, with the private key normalised.
 *
 * The key may be stored as:
 * 1. Full PEM (with BEGIN/END markers and newlines)
 * 2. PEM with escaped newlines (\\n → \n)
 * 3. Raw base64 DER content (no PEM headers)
 */
function appCredentials(): { appId: number; privateKey: string } {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY

  if (!appId || !privateKey) {
    throw new Error(
      'Missing GitHub App env vars: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY'
    )
  }

  let decodedKey: string
  if (privateKey.includes('BEGIN')) {
    decodedKey = privateKey.replace(/\\n/g, '\n')
  } else {
    const lines = privateKey.match(/.{1,64}/g) ?? [privateKey]
    decodedKey = `-----BEGIN RSA PRIVATE KEY-----\n${lines.join('\n')}\n-----END RSA PRIVATE KEY-----\n`
  }

  return { appId: Number(appId), privateKey: decodedKey }
}

/**
 * A JWT signed with the App's private key — the App speaking as itself, for the
 * `/app/**` endpoints (reading or deleting an installation). Not a token for
 * repository data; use an installation token for that.
 */
export async function getGithubAppJwt(): Promise<string> {
  const auth = createAppAuth(appCredentials())
  const { token } = await auth({ type: 'app' })
  return token
}

/**
 * LUM-889 — the permission names GitHub accepts on an installation token
 * (REST "Create an installation access token" → `permissions`). A literal
 * union, so a misspelling such as `pull_request` fails the type check instead
 * of reaching GitHub and coming back as a 422 that takes the feature down.
 */
export type GitHubAppPermissionName =
  // repository
  | 'actions'
  | 'administration'
  | 'artifact_metadata'
  | 'attestations'
  | 'checks'
  | 'code_quality'
  | 'codespaces'
  | 'contents'
  | 'dependabot_secrets'
  | 'deployments'
  | 'discussions'
  | 'environments'
  | 'issues'
  | 'merge_queues'
  | 'metadata'
  | 'packages'
  | 'pages'
  | 'pull_requests'
  | 'repository_custom_properties'
  | 'repository_hooks'
  | 'repository_projects'
  | 'secret_scanning_alerts'
  | 'secrets'
  | 'security_events'
  | 'single_file'
  | 'statuses'
  | 'vulnerability_alerts'
  | 'workflows'
  // organization
  | 'members'
  | 'organization_administration'
  | 'organization_announcement_banners'
  | 'organization_copilot_seat_management'
  | 'organization_custom_org_roles'
  | 'organization_custom_properties'
  | 'organization_custom_roles'
  | 'organization_events'
  | 'organization_hooks'
  | 'organization_packages'
  | 'organization_personal_access_token_requests'
  | 'organization_personal_access_tokens'
  | 'organization_plan'
  | 'organization_projects'
  | 'organization_secrets'
  | 'organization_self_hosted_runners'
  | 'organization_user_blocking'
  | 'team_discussions'
  // account
  | 'email_addresses'
  | 'followers'
  | 'git_ssh_keys'
  | 'gpg_keys'
  | 'interaction_limits'
  | 'profile'
  | 'starring'

export type RepoTokenPermissions = Partial<
  Record<GitHubAppPermissionName, 'read' | 'write'>
>

/** GitHub reads "no permissions" as "all of the installation's permissions". */
function requirePermissionSet(
  permissions: RepoTokenPermissions | undefined,
  what: string
): void {
  if (!permissions || Object.keys(permissions).length === 0) {
    throw new Error(`${what} needs an explicit permission set`)
  }
}

/**
 * Installation token for an installation id already in hand, reaching every
 * repository the installation does. Only for listing the installation's
 * repositories and the access recheck, which must see the whole installation
 * before (or regardless of) any repository being confirmed; repository data
 * goes through `getRepoToken`.
 *
 * LUM-890: `permissions` is required — pick the set from
 * `INSTALLATION_TOKEN_PERMISSIONS` (./token-permissions). An empty set is
 * refused, as in `getRepoToken`.
 */
export async function createInstallationToken(
  installationId: number,
  permissions: RepoTokenPermissions
): Promise<string> {
  requirePermissionSet(
    permissions,
    `createInstallationToken (installation ${installationId})`
  )
  const auth = createAppAuth({ ...appCredentials(), installationId })
  const { token } = await auth({ type: 'installation', permissions })
  return token
}

/**
 * LUM-883 — the token for reading (or writing to) ONE confirmed repository.
 * Throws 403 `repo_not_confirmed` before minting anything when `repository`
 * is not on the workspace's confirmed list, 400 `app_not_installed` with no
 * installation.
 *
 * LUM-886: `permissions` is required — pick the set from
 * `REPO_TOKEN_PERMISSIONS` (./token-permissions). An empty set is refused
 * rather than minted, because GitHub reads "no permissions" as "all of the
 * installation's permissions".
 */
export async function getRepoToken(
  workspaceId: string,
  repository: string,
  permissions: RepoTokenPermissions
): Promise<string> {
  requirePermissionSet(permissions, `getRepoToken (repository ${repository})`)
  const installationId = await resolveConfirmedInstallation(
    workspaceId,
    repository
  )
  const auth = createAppAuth({ ...appCredentials(), installationId })
  const { token } = await auth({
    type: 'installation',
    repositoryNames: [repoName(repository)],
    permissions,
  })
  return token
}

/**
 * LUM-852 — the token a sandbox clones with. Scoped to ONE repository with
 * `contents: read` and nothing else, so a token that leaks out of the VM (the
 * CodeRabbit 2025 class: a scanner reads repository config and prints its
 * environment) opens exactly the checkout the attacker already has. Callers
 * revoke it with `revokeInstallationToken` as soon as the clone is done.
 * LUM-883: only for a confirmed repository, like every other mint.
 *
 * A fresh `createAppAuth` per call on purpose: its token cache is
 * per-instance, and a cached copy of a token we have since revoked must never
 * be handed out again.
 */
export async function getRepoCloneToken(
  workspaceId: string,
  repository: string
): Promise<string> {
  const installationId = await resolveConfirmedInstallation(
    workspaceId,
    repository
  )
  return createRepoScopedToken(installationId, repository)
}

/** GitHub mints by repository name within the installation's account. */
function repoName(repository: string): string {
  const name = repository.slice(repository.indexOf('/') + 1)
  if (!name || name === repository) {
    throw new Error(`Not an owner/repo name: "${repository}"`)
  }
  return name
}

/**
 * The scoped mint itself, for an installation id already in hand (the
 * LUM-852 sandbox probe has no workspace row to resolve). Same request as
 * `getRepoCloneToken` — one repository, `contents: read`.
 *
 * LUM-889: NOT in the `@/lib/integrations/github` barrel — no confirmed-list
 * check, so product code must never call it. The token-mint guard test
 * (`__tests__/lib/integrations/github/token-mint-guard.lum889.test.ts`)
 * allows it only inside this file and the operator probe scripts.
 */
export async function createRepoScopedToken(
  installationId: number,
  repository: string
): Promise<string> {
  return createRepoTokenForInstallation(installationId, repository, {
    contents: 'read',
  })
}

/**
 * LUM-886 — one repository, an explicit permission set, an installation id
 * already in hand. No confirmed-list check: only for operator probes that
 * have no workspace row (the LUM-886 permission probe). Product paths go
 * through `getRepoToken`. An empty set is refused, as there.
 *
 * LUM-889: NOT in the barrel, for the same reason as `createRepoScopedToken`.
 */
export async function createRepoTokenForInstallation(
  installationId: number,
  repository: string,
  permissions: RepoTokenPermissions
): Promise<string> {
  requirePermissionSet(
    permissions,
    `createRepoTokenForInstallation (repository ${repository})`
  )
  const name = repoName(repository)
  const auth = createAppAuth({ ...appCredentials(), installationId })
  const { token } = await auth({
    type: 'installation',
    repositoryNames: [name],
    permissions,
  })
  return token
}

/**
 * LUM-852 — `DELETE /installation/token`, authenticated as the token itself.
 * Never throws and never logs the token: revocation is cleanup on paths that
 * are already succeeding or already failing for their own reason. 401 means
 * the token is already dead, which is the outcome we wanted.
 */
export async function revokeInstallationToken(token: string): Promise<boolean> {
  if (!token) return false
  try {
    const res = await fetch('https://api.github.com/installation/token', {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (res.status === 204 || res.status === 401) return true
    logger.warn(`[github/auth] token revoke returned HTTP ${res.status}`)
    return false
  } catch (error) {
    logger.warn(
      `[github/auth] token revoke failed: ${
        error instanceof Error ? error.name : 'unknown error'
      }`
    )
    return false
  }
}
