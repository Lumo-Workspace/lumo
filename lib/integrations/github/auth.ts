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
 * LEGACY: a workspace with no row (or a call with no workspaceId) falls back to
 * the global GITHUB_APP_INSTALLATION_ID env var — Lumo's own installation, from
 * before the install flow existed. It is wrong for every other workspace (the
 * clone silently targets repositories Lumo owns), so the fallback logs a
 * warning and is scheduled for removal once Lumo itself installs through the
 * normal flow. See README "GitHub App permissions".
 */
async function resolveInstallationId(workspaceId?: string): Promise<number> {
  if (workspaceId) {
    const row =
      await githubAppInstallationRepository.findByWorkspace(workspaceId)
    if (row) return row.installationId
    logger.warn(
      `[github/auth] no GitHubAppInstallation for workspace ${workspaceId}; falling back to legacy GITHUB_APP_INSTALLATION_ID — this workspace has not installed the Lumo GitHub App`
    )
  }
  const envId = process.env.GITHUB_APP_INSTALLATION_ID
  if (!envId) {
    throw new Error(
      'No GitHubAppInstallation for workspace and GITHUB_APP_INSTALLATION_ID not set'
    )
  }
  const parsed = Number(envId)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `GITHUB_APP_INSTALLATION_ID is not a valid installation id: "${envId}"`
    )
  }
  return parsed
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
