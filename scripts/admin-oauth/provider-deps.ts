/**
 * LUM-1344 — the real provider calls behind register-console-client.ts.
 *
 * The OAuth provider's server-only `adminCreateOAuthClient` and
 * `adminLinkClientResource` endpoints require a signed-in session, so the
 * operator names an existing platform admin (`--operator-email`); a
 * short-lived session is minted for that user, used for the two calls, and
 * deleted again. Takes the Better Auth instance as a parameter (the caller
 * decides which database it is bound to).
 */
import { createHmac } from 'node:crypto'
import type { ConsoleClientSpec, ProviderHandle } from './console-client'
import { toProviderClientBody } from './console-client'

interface AdminAuthApi {
  adminCreateOAuthClient(i: {
    headers: Headers
    body: ReturnType<typeof toProviderClientBody>
  }): Promise<{ client_id: string; client_secret?: string }>
  adminLinkClientResource(i: {
    headers: Headers
    params: { identifier: string; client_id: string }
  }): Promise<unknown>
  adminUnlinkClientResource(i: {
    headers: Headers
    params: { identifier: string; client_id: string }
  }): Promise<unknown>
}

export interface AdminCapableAuth {
  api: unknown
  $context: Promise<{
    secret: string
    authCookies: { sessionToken: { name: string } }
    internalAdapter: {
      findUserByEmail(email: string): Promise<{
        user: { id: string; role?: string | null; banned?: boolean | null }
      } | null>
      createSession(userId: string): Promise<{ token: string } | null>
      deleteSession(token: string): Promise<void>
    }
  }>
}

/** Better Auth's signed cookie value: `<value>.<base64 HMAC-SHA256>`, URL-encoded. */
export function signCookieValue(value: string, secret: string): string {
  const sig = createHmac('sha256', secret).update(value).digest('base64')
  return encodeURIComponent(`${value}.${sig}`)
}

export async function openAdminProvider(
  auth: AdminCapableAuth,
  resources: { adminResource: string; mcpResource: string },
  operatorEmail: string
): Promise<ProviderHandle> {
  const ctx = await auth.$context
  const found = await ctx.internalAdapter.findUserByEmail(operatorEmail)
  const user = found?.user
  if (!user || user.role !== 'admin' || user.banned === true) {
    throw new Error(
      'the operator must be an existing, non-banned user with role "admin"'
    )
  }
  const session = await ctx.internalAdapter.createSession(user.id)
  if (!session) throw new Error('could not create the operator session')
  const headers = new Headers({
    cookie: `${ctx.authCookies.sessionToken.name}=${signCookieValue(session.token, ctx.secret)}`,
  })
  const api = auth.api as AdminAuthApi
  return {
    deps: {
      createClient: (spec: ConsoleClientSpec) =>
        api.adminCreateOAuthClient({
          headers,
          body: toProviderClientBody(spec),
        }),
      linkAdminResourceOnly: async clientId => {
        await api.adminLinkClientResource({
          headers,
          params: { identifier: resources.adminResource, client_id: clientId },
        })
        // New clients are linked to the MCP resource by default; the console
        // must not be able to obtain an MCP-audience token.
        await api.adminUnlinkClientResource({
          headers,
          params: { identifier: resources.mcpResource, client_id: clientId },
        })
      },
    },
    close: () => ctx.internalAdapter.deleteSession(session.token),
  }
}
