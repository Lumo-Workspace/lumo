import { logger } from '@/lib/logger'
import { createAppAuth } from '@octokit/auth-app'
import { githubAppInstallationRepository } from '@/lib/repositories/github-app-installation.repository'

/**
 * Returns a short-lived GitHub installation token for the Lumo Agent app.
 *
 * App credentials (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY) stay in env — one
 * Lumo App, many installations. The installationId is resolved per-workspace
 * from GitHubAppInstallation; if a workspace has no row (or no workspaceId is
 * passed) we fall back to the legacy global GITHUB_APP_INSTALLATION_ID env var
 * during the transition, logging a warning so we can observe migration progress.
 */
async function resolveInstallationId(workspaceId?: string): Promise<number> {
  if (workspaceId) {
    const row =
      await githubAppInstallationRepository.findByWorkspace(workspaceId)
    if (row) return row.installationId
    logger.warn(
      `[github/auth] no GitHubAppInstallation for workspace ${workspaceId}; falling back to GITHUB_APP_INSTALLATION_ID`
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

export async function getGithubInstallationToken(
  workspaceId?: string
): Promise<string> {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY

  if (!appId || !privateKey) {
    throw new Error(
      'Missing GitHub App env vars: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY'
    )
  }

  const installationId = await resolveInstallationId(workspaceId)

  // Private key may be stored as:
  // 1. Full PEM (with BEGIN/END markers and newlines)
  // 2. PEM with escaped newlines (\\n → \n)
  // 3. Raw base64 DER content (no PEM headers)
  let decodedKey: string
  if (privateKey.includes('BEGIN')) {
    decodedKey = privateKey.replace(/\\n/g, '\n')
  } else {
    const lines = privateKey.match(/.{1,64}/g) ?? [privateKey]
    decodedKey = `-----BEGIN RSA PRIVATE KEY-----\n${lines.join('\n')}\n-----END RSA PRIVATE KEY-----\n`
  }

  const auth = createAppAuth({
    appId: Number(appId),
    privateKey: decodedKey,
    installationId,
  })

  const { token } = await auth({ type: 'installation' })
  return token
}
