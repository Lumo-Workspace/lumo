/**
 * LUM-1344 — pure core of scripts/admin-oauth/register-console-client.ts.
 *
 * The lumo-admin console signs admins in with OAuth authorization code +
 * PKCE against this app, asking for resource <origin>/api/admin and scope
 * `platform-admin`. Dynamic client registration cannot obtain that scope, so
 * an operator creates the client server-side. Nothing here touches a
 * database: the provider call is injected (see register-console-client.ts).
 */
import { parseArgs } from 'node:util'

const PLATFORM_ADMIN_SCOPE = 'platform-admin'

export interface ConsoleClientSpec {
  name: string
  redirectUris: string[]
  scopes: ['platform-admin']
  grantTypes: ['authorization_code']
  responseTypes: ['code']
  tokenEndpointAuthMethod: 'client_secret_basic'
  skipConsent: true
  /** The one protected resource the client is linked to: the admin API. */
  resource: 'admin'
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

function validateRedirectUri(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`redirect URI is not a valid URL: ${raw}`)
  }
  if (raw.includes('#') || url.hash) {
    throw new Error(`redirect URI must not contain a fragment: ${raw}`)
  }
  const localHttp =
    url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname) && url.port !== ''
  if (url.protocol !== 'https:' && !localHttp) {
    throw new Error(
      `redirect URI must be https (http only for localhost:<port> / 127.0.0.1:<port>): ${raw}`
    )
  }
  return raw
}

export function buildConsoleClientSpec(input: {
  name: string
  redirectUris: string[]
}): ConsoleClientSpec {
  const name = input.name.trim()
  if (!name) throw new Error('client name is required')
  if (input.redirectUris.length === 0) {
    throw new Error('at least one redirect URI is required')
  }
  return {
    name,
    redirectUris: input.redirectUris.map(validateRedirectUri),
    scopes: [PLATFORM_ADMIN_SCOPE],
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    skipConsent: true,
    resource: 'admin',
  }
}

/** The body of the provider's adminCreateOAuthClient endpoint. */
export function toProviderClientBody(spec: ConsoleClientSpec) {
  return {
    client_name: spec.name,
    redirect_uris: spec.redirectUris,
    scope: spec.scopes.join(' '),
    grant_types: spec.grantTypes,
    response_types: spec.responseTypes,
    token_endpoint_auth_method: spec.tokenEndpointAuthMethod,
    skip_consent: spec.skipConsent,
    require_pkce: true,
  }
}

export interface RegisterDeps {
  createClient(
    spec: ConsoleClientSpec
  ): Promise<{ client_id: string; client_secret?: string }>
  /**
   * Links the client to the admin resource and nothing else (the provider
   * also links new clients to the default MCP resource; that link goes).
   */
  linkAdminResourceOnly(clientId: string): Promise<void>
}

export async function registerConsoleClient(
  spec: ConsoleClientSpec,
  deps: RegisterDeps
): Promise<{ clientId: string; clientSecret: string }> {
  const created = await deps.createClient(spec)
  if (!created.client_secret) {
    throw new Error(
      `provider returned no client secret for client ${created.client_id}; delete that client and retry`
    )
  }
  try {
    await deps.linkAdminResourceOnly(created.client_id)
  } catch (err) {
    // Never include the secret: it is the one thing that must stay unlogged.
    throw new Error(
      `client ${created.client_id} was created but linking it to the admin resource failed (${(err as Error).message}); delete that client and retry`
    )
  }
  return { clientId: created.client_id, clientSecret: created.client_secret }
}

export interface ConsoleClientArgs {
  name: string
  redirectUris: string[]
  operatorEmail: string
  confirm: boolean
}

export const USAGE =
  'Usage: npx tsx scripts/admin-oauth/register-console-client.ts --name <name> ' +
  '--redirect-uri <https-url> [--redirect-uri <url> ...] --operator-email <admin email> [--confirm]\n' +
  'Without --confirm this is a dry run: it prints the client spec and creates nothing.'

export function parseConsoleClientArgs(argv: string[]): ConsoleClientArgs {
  let values: {
    name?: string
    'redirect-uri'?: string[]
    'operator-email'?: string
    confirm?: boolean
  }
  try {
    values = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        name: { type: 'string' },
        'redirect-uri': { type: 'string', multiple: true },
        'operator-email': { type: 'string' },
        confirm: { type: 'boolean', default: false },
      },
    }).values
  } catch (err) {
    throw new Error(`${(err as Error).message}\n${USAGE}`)
  }
  if (!values.name?.trim()) throw new Error(`--name is required\n${USAGE}`)
  if (!values['redirect-uri']?.length) {
    throw new Error(`at least one --redirect-uri is required\n${USAGE}`)
  }
  const email = values['operator-email']?.trim().toLowerCase()
  if (!email) {
    throw new Error(
      `--operator-email (an existing admin user that performs the registration) is required\n${USAGE}`
    )
  }
  return {
    name: values.name.trim(),
    redirectUris: values['redirect-uri'],
    operatorEmail: email,
    confirm: values.confirm === true,
  }
}

export interface ProviderHandle {
  deps: RegisterDeps
  close(): Promise<void>
}

export interface RunIo {
  stdout(line: string): void
  stderr(line: string): void
}

export interface RunDeps {
  /** Opens the provider session. Called only with --confirm. */
  openProvider(operatorEmail: string): Promise<ProviderHandle>
  io: RunIo
}

/** Run with `argv`; resolves to the process exit code (0 ok, 1 error). */
export async function runRegisterConsoleClient(
  argv: string[],
  deps: RunDeps
): Promise<number> {
  try {
    const args = parseConsoleClientArgs(argv)
    const spec = buildConsoleClientSpec({
      name: args.name,
      redirectUris: args.redirectUris,
    })
    if (!args.confirm) {
      deps.io.stdout(
        [
          '[dry-run] would register this OAuth client',
          JSON.stringify({ ...spec, operator: args.operatorEmail }, null, 2),
          'Nothing was written. Re-run with --confirm to create it.',
        ].join('\n')
      )
      return 0
    }
    const handle = await deps.openProvider(args.operatorEmail)
    try {
      const { clientId, clientSecret } = await registerConsoleClient(
        spec,
        handle.deps
      )
      deps.io.stdout(`client id: ${clientId}`)
      deps.io.stdout(
        `client secret: ${clientSecret}  (not stored in plain text; it cannot be shown again, keep it now)`
      )
    } finally {
      await handle.close()
    }
    return 0
  } catch (err) {
    deps.io.stderr(`error: ${(err as Error).message}\n`)
    return 1
  }
}
