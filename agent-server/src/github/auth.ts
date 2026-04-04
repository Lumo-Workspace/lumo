import { createAppAuth } from '@octokit/auth-app'

/**
 * Returns a short-lived GitHub installation token for the Lumo Agent app.
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
    installationId: Number(installationId),
  })

  const { token } = await auth({ type: 'installation' })
  return token
}
