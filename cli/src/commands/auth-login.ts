import { promptSecret } from '../lib/prompt'
import { openBrowser } from '../lib/browser'
import { resolveApiUrl, trimTrailingSlash, verifyToken } from '../lib/api'
import { writeCredentials } from '../lib/config'
import { sanitizeField } from '../lib/sanitize'

const KEY_PREFIX = 'lum_'

export async function authLogin(): Promise<number | void> {
  const apiUrl = resolveApiUrl()
  const webUrl = trimTrailingSlash(apiUrl)

  console.log('Log in to Lumo')
  console.log('')
  console.log(`  1. Open ${webUrl} and go to Settings → API Keys`)
  console.log(`  2. Create a new key and copy it`)
  console.log(`  3. Paste it below`)
  console.log('')
  console.log('Opening your browser…')
  openBrowser(webUrl)
  console.log('')

  const token = await promptSecret('API key (input hidden): ')
  if (!token) {
    console.log('Login cancelled.')
    return 1
  }

  if (!token.startsWith(KEY_PREFIX)) {
    console.error(`Error: API key must start with "${KEY_PREFIX}"`)
    return 1
  }

  let resp
  try {
    resp = await verifyToken(apiUrl, token)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`Error: ${msg}`)
    return 1
  }

  writeCredentials({
    token,
    apiUrl,
    userId: resp.user.id,
    email: resp.user.email,
    workspaceId: resp.workspace.id,
    workspaceSlug: resp.workspace.slug,
    workspaceName: resp.workspace.name,
    apiKeyId: resp.apiKey.id,
    apiKeyName: resp.apiKey.name,
    apiKeyPrefix: resp.apiKey.prefix,
  })

  console.log('')
  console.log(`✓ Logged in as ${sanitizeField(resp.user.email)}`)
  console.log(`  Workspace: ${sanitizeField(resp.workspace.name)}`)
  console.log(
    `  Key: ${sanitizeField(resp.apiKey.name)} (${resp.apiKey.prefix})`
  )
}
