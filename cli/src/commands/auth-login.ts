import { promptSecret } from '../lib/prompt'
import { openBrowser } from '../lib/browser'
import {
  assertSafeApiUrl,
  requestLocalCliKey,
  resolveApiUrl,
  trimTrailingSlash,
  serverLabel,
  verifyToken,
} from '../lib/api'
import { saveLogin } from '../lib/config'
import { sanitizeField } from '../lib/sanitize'

const KEY_PREFIX = 'lum_'

export interface AuthLoginOptions {
  /** LUM-1335: the server to log in to (a self-hosted URL); else LUMO_API_URL / hosted. */
  url?: string
  /** LUM-1335: fail instead of asking for a key (scripts, e.g. setup.sh --local). */
  paste?: boolean
  /** LUM-1337: false = store the login without pointing this repository at it. */
  bind?: boolean
}

/** The key to log in with: issued by a local-mode server, else pasted. */
async function obtainKey(
  apiUrl: string,
  allowPaste: boolean
): Promise<string | null> {
  const local = await requestLocalCliKey(apiUrl)
  if (local.status === 'issued') {
    console.log(`Local mode: ${apiUrl} issued an API key for this machine.`)
    return local.key
  }
  if (local.status === 'refused') {
    console.log(
      `Local mode did not issue a key: ${sanitizeField(local.message)}`
    )
    console.log('')
  }
  if (!allowPaste) {
    console.error(
      `Error: ${apiUrl} did not issue a key (not in local mode, or it refused) and --no-paste is set`
    )
    return null
  }
  return pasteKey(trimTrailingSlash(apiUrl))
}

async function pasteKey(webUrl: string): Promise<string | null> {
  console.log('Log in to Lumo')
  console.log('')
  console.log(`  1. Open ${webUrl} and go to Settings → API Keys`)
  console.log(`  2. Create a new key and copy it`)
  console.log(`  3. Paste it below`)
  console.log('')
  console.log('Opening your browser…')
  openBrowser(webUrl)
  console.log('')

  return (await promptSecret('API key (input hidden): ')) || null
}

export async function authLogin(
  opts: AuthLoginOptions = {}
): Promise<number | void> {
  let apiUrl: string
  if (opts.url !== undefined) {
    apiUrl = trimTrailingSlash(opts.url.trim())
    try {
      new URL(apiUrl)
    } catch {
      console.error(`Error: --url "${apiUrl}" is not a valid URL`)
      return 1
    }
    try {
      assertSafeApiUrl(apiUrl)
    } catch (err) {
      console.error(
        `Error: ${err instanceof Error ? err.message : String(err)}`
      )
      return 1
    }
  } else {
    apiUrl = resolveApiUrl()
  }

  let token: string | null
  try {
    token = await obtainKey(apiUrl, opts.paste !== false)
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  }
  if (!token) {
    if (opts.paste !== false) console.log('Login cancelled.')
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

  const saved = saveLogin(
    {
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
    },
    opts.bind === false ? {} : { bindCwd: process.cwd() }
  )

  console.log('')
  console.log(`✓ Logged in as ${sanitizeField(resp.user.email)}`)
  console.log(`  Workspace: ${sanitizeField(resp.workspace.name)}`)
  // LUM-1335: a login to a self-hosted Lumo says so.
  const server = serverLabel(apiUrl)
  if (server) console.log(`  Server: ${sanitizeField(server)}`)
  console.log(
    `  Key: ${sanitizeField(resp.apiKey.name)} (${resp.apiKey.prefix})`
  )
  // LUM-1337: say which repositories this login now serves.
  if (saved.isDefault) {
    console.log(
      '  Used by: every repository not bound to another login (default)'
    )
  } else if (saved.boundRepo) {
    console.log(`  Used by: ${sanitizeField(saved.boundRepo)}`)
  } else {
    console.log(
      `  Not used yet — in a repository: lumo auth use ${saved.key}; everywhere: lumo auth use ${saved.key} --default`
    )
  }
}
