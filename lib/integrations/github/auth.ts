import { logger } from '@/lib/logger'
import { createAppAuth } from '@octokit/auth-app'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'

/**
 * Returns a short-lived GitHub installation token for the Lumo Agent app.
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
 */
async function resolveInstallationId(workspaceId?: string): Promise<number> {
  if (!workspaceId) {
    throw new Error(
      'No workspace given; a GitHub installation token is always per workspace'
    )
  }
  const row = await githubAppInstallationRepository.findByWorkspace(workspaceId)
  if (!row) {
    logger.warn(
      `[github/auth] no GitHubAppInstallation for workspace ${workspaceId}; the Lumo GitHub App is not installed there`
    )
    throw new Error(
      `No GitHubAppInstallation for workspace ${workspaceId} — install the Lumo GitHub App`
    )
  }
  return row.installationId
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

/** Installation token for an installation id already in hand. */
export async function createInstallationToken(
  installationId: number
): Promise<string> {
  const auth = createAppAuth({ ...appCredentials(), installationId })
  const { token } = await auth({ type: 'installation' })
  return token
}

export async function getGithubInstallationToken(
  workspaceId?: string
): Promise<string> {
  return createInstallationToken(await resolveInstallationId(workspaceId))
}

/**
 * LUM-852 — the token a sandbox clones with. Scoped to ONE repository with
 * `contents: read` and nothing else, so a token that leaks out of the VM (the
 * CodeRabbit 2025 class: a scanner reads repository config and prints its
 * environment) opens exactly the checkout the attacker already has. Callers
 * revoke it with `revokeInstallationToken` as soon as the clone is done.
 *
 * A fresh `createAppAuth` per call on purpose: its token cache is
 * per-instance, and a cached copy of a token we have since revoked must never
 * be handed out again.
 */
export async function getRepoCloneToken(
  workspaceId: string,
  repository: string
): Promise<string> {
  const name = repository.slice(repository.indexOf('/') + 1)
  if (!name || name === repository) {
    throw new Error(`Not an owner/repo name: "${repository}"`)
  }
  const auth = createAppAuth({
    ...appCredentials(),
    installationId: await resolveInstallationId(workspaceId),
  })
  const { token } = await auth({
    type: 'installation',
    repositoryNames: [name],
    permissions: { contents: 'read' },
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
