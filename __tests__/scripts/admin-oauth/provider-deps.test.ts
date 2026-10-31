/**
 * @jest-environment node
 *
 * LUM-1344 — the real provider calls of the console-client script, run
 * against the in-memory Better Auth + OAuth provider (no database).
 */
import { randomBytes } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import {
  MCP_OAUTH_DISABLED_PATHS,
  mcpOAuthPlugins,
} from '@/lib/auth/better-auth/mcp-oauth-plugins'
import { resolveMcpOAuthUrls } from '@/lib/auth/better-auth/mcp-oauth-config'
import {
  buildConsoleClientSpec,
  registerConsoleClient,
} from '../../../scripts/admin-oauth/console-client'
import {
  openAdminProvider,
  type AdminCapableAuth,
} from '../../../scripts/admin-oauth/provider-deps'

const BASE = 'http://localhost:3000'
const urls = resolveMcpOAuthUrls({ BETTER_AUTH_URL: BASE })!
const db: Record<string, unknown[]> = Object.fromEntries(
  [
    'authUser',
    'authSession',
    'authAccount',
    'authVerification',
    'authJwks',
    'authOauthClient',
    'authOauthResource',
    'authOauthClientResource',
    'authOauthRefreshToken',
    'authOauthAccessToken',
    'authOauthConsent',
    'authOauthClientAssertion',
  ].map(t => [t, []])
)
const auth = betterAuth({
  secret: randomBytes(32).toString('base64'),
  baseURL: BASE,
  basePath: '/api/auth',
  database: memoryAdapter(db),
  telemetry: { enabled: false },
  emailAndPassword: { enabled: true },
  user: {
    modelName: 'authUser',
    // The production instance gets these from the admin plugin.
    additionalFields: {
      role: { type: 'string', required: false },
      banned: { type: 'boolean', required: false },
    },
  },
  session: { modelName: 'authSession' },
  account: { modelName: 'authAccount' },
  verification: { modelName: 'authVerification' },
  disabledPaths: MCP_OAUTH_DISABLED_PATHS,
  plugins: mcpOAuthPlugins(urls),
})
const asAdminAuth = auth as unknown as AdminCapableAuth

async function seedUser(email: string, role: string | null, banned = false) {
  const ctx = await auth.$context
  const createUser = ctx.internalAdapter.createUser as unknown as (
    data: Record<string, unknown>
  ) => Promise<unknown>
  await createUser({
    email,
    name: email,
    emailVerified: true,
    ...(role ? { role } : {}),
    banned,
  })
}

describe('openAdminProvider (in-memory provider)', () => {
  it('creates a confidential skip-consent client linked to the admin resource only, then drops the session', async () => {
    await seedUser('ops@example.com', 'admin')
    const handle = await openAdminProvider(
      asAdminAuth,
      { adminResource: urls.adminResource, mcpResource: urls.resource },
      'ops@example.com'
    )
    const out = await registerConsoleClient(
      buildConsoleClientSpec({
        name: 'Lumo Admin',
        redirectUris: ['https://admin.example.com/cb'],
      }),
      handle.deps
    )
    expect(out.clientId).toBeTruthy()
    expect(out.clientSecret).toBeTruthy()
    const client = db.authOauthClient!.find(
      c => (c as { clientId: string }).clientId === out.clientId
    ) as Record<string, unknown>
    expect(client).toMatchObject({
      skipConsent: true,
      tokenEndpointAuthMethod: 'client_secret_basic',
      scopes: ['platform-admin'],
      grantTypes: ['authorization_code'],
    })
    expect(client.clientSecret).not.toBe(out.clientSecret) // hashed at rest
    expect(
      db.authOauthClientResource!.filter(
        l => (l as { clientId: string }).clientId === out.clientId
      )
    ).toEqual([expect.objectContaining({ resourceId: urls.adminResource })])
    expect(db.authSession).toHaveLength(1)
    await handle.close()
    expect(db.authSession).toHaveLength(0)
  })

  it('refuses a non-admin, a banned admin and an unknown operator', async () => {
    await seedUser('plain@example.com', null)
    await seedUser('banned@example.com', 'admin', true)
    for (const email of [
      'plain@example.com',
      'banned@example.com',
      'nobody@example.com',
    ]) {
      await expect(
        openAdminProvider(
          asAdminAuth,
          { adminResource: urls.adminResource, mcpResource: urls.resource },
          email
        )
      ).rejects.toThrow(/admin/)
    }
  })

  it('mints a session that lasts about 5 minutes', async () => {
    await seedUser('ttl@example.com', 'admin')
    const before = db.authSession!.length
    const handle = await openAdminProvider(
      asAdminAuth,
      { adminResource: urls.adminResource, mcpResource: urls.resource },
      'ttl@example.com'
    )
    const row = db.authSession![before] as { expiresAt: Date }
    const ms = row.expiresAt.getTime() - Date.now()
    expect(ms).toBeGreaterThan(4 * 60_000)
    expect(ms).toBeLessThanOrEqual(5 * 60_000)
    await handle.close()
  })

  it('deletes the half-made client when the MCP unlink fails and says so', async () => {
    await seedUser('ops2@example.com', 'admin')
    const handle = await openAdminProvider(
      asAdminAuth,
      {
        adminResource: urls.adminResource,
        // not a linked resource id -> force the unlink to be the failing step
        mcpResource: urls.resource,
      },
      'ops2@example.com'
    )
    const api = auth.api as unknown as {
      adminUnlinkClientResource: (...a: unknown[]) => Promise<unknown>
    }
    const real = api.adminUnlinkClientResource
    api.adminUnlinkClientResource = async () => {
      throw new Error('unlink boom')
    }
    try {
      const before = db.authOauthClient!.length
      const err = await registerConsoleClient(
        buildConsoleClientSpec({
          name: 'Half',
          redirectUris: ['https://half.example.com/cb'],
        }),
        handle.deps
      ).catch((e: Error) => e)
      expect((err as Error).message).toContain(
        'linked to the admin resource AND still linked to MCP'
      )
      expect((err as Error).message).toContain('was deleted')
      expect(db.authOauthClient!.length).toBe(before)
    } finally {
      api.adminUnlinkClientResource = real
      await handle.close()
    }
  })
})
