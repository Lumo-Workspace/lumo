import { createAppAuth } from '@octokit/auth-app'

/**
 * Returns a short-lived GitHub installation token for the Lumo Agent app.
 * Uses GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_INSTALLATION_ID.
 */
export async function getGithubInstallationToken(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID

  if (!appId || !privateKey || !installationId) {
    throw new Error(
      'Missing GitHub App env vars: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID'
    )
  }

  // Private key may be base64-encoded in env vars
  const decodedKey = privateKey.includes('BEGIN')
    ? privateKey
    : Buffer.from(privateKey, 'base64').toString('utf-8')

  const auth = createAppAuth({
    appId: Number(appId),
    privateKey: decodedKey,
    installationId: Number(installationId),
  })

  const { token } = await auth({ type: 'installation' })
  return token
}
