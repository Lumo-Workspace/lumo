/**
 * LUM-1027 — the browser-side Better Auth client (same origin, /api/auth).
 * Created on first use, never during module load.
 *
 * LUM-1044: `oauthProviderClient()` attaches the signed OAuth request of the
 * current page (`?…&sig=…`) to POSTs, so signing in on /signin or deciding on
 * /oauth/consent continues the MCP client's authorization. It does nothing on
 * pages without a signed request.
 */
import { createAuthClient } from 'better-auth/react'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { BETTER_AUTH_BASE_PATH } from './config'

function create() {
  return createAuthClient({
    basePath: BETTER_AUTH_BASE_PATH,
    plugins: [oauthProviderClient()],
  })
}

let client: ReturnType<typeof create> | null = null

export function getAuthClient() {
  client ??= create()
  return client
}
