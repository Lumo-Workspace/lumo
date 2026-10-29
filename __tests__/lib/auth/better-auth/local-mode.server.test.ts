/**
 * @jest-environment node
 *
 * LUM-1335 — GET /api/auth/lumo/local-sign-in through the REAL Lumo Better
 * Auth instance (lib/auth/better-auth/server.ts) and its HTTP handler; only
 * the Prisma adapter is Better Auth's in-memory adapter.
 */
import { randomBytes } from 'node:crypto'

const BASE = 'http://localhost:3000'

const mockDb: Record<string, Array<Record<string, unknown>>> = {}
for (const t of [
  'authUser',
  'authSession',
  'authAccount',
  'authVerification',
  'authRateLimit',
  // MCP OAuth (on whenever BETTER_AUTH_URL is set) reads these at start-up.
  'authJwks',
  'authOauthClient',
  'authOauthResource',
  'authOauthClientResource',
  'authOauthRefreshToken',
  'authOauthAccessToken',
  'authOauthConsent',
  'authOauthClientAssertion',
]) {
  mockDb[t] = []
}

jest.mock('better-auth/adapters/prisma', () => {
  const { memoryAdapter } = jest.requireActual('better-auth/adapters/memory')
  return { prismaAdapter: () => memoryAdapter(mockDb) }
})
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/repositories/auth-user.repository', () => ({
  authUserRepository: { findById: async () => null },
}))
jest.mock('@/lib/integrations/email/client', () => ({ sendEmail: jest.fn() }))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: () => undefined }))
const mockLogger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
jest.mock('@/lib/logger', () => ({ logger: mockLogger }))

type Instance = {
  handler: (req: Request) => Promise<Response>
  api: {
    getSession: (o: {
      headers: Headers
    }) => Promise<{ user: { id: string } } | null>
  }
}
type ServerModule = typeof import('@/lib/auth/better-auth/server')

const TOUCHED_ENV = [
  'NODE_ENV',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'LUMO_MODE',
  'RESEND_API_KEY',
  'SMTP_URL',
  'SMTP_HOST',
] as const
const savedEnv: Record<string, string | undefined> = {}
let server: ServerModule

function rebuild(
  env: Record<string, string | undefined>,
  baseUrl = BASE
): Instance {
  for (const [k, v] of Object.entries({ ...env, BETTER_AUTH_URL: baseUrl })) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  globalThis.lumoBetterAuth = undefined
  return server.getBetterAuth() as unknown as Instance
}

const signIn = (instance: Instance, query = '') =>
  instance.handler(
    new Request(`${BASE}/api/auth/lumo/local-sign-in${query}`, {
      headers: { 'x-forwarded-for': '10.9.0.1' },
    })
  )

/** The session cookie a response set, as a Cookie request header. */
function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ')
}

function seedUser(id: string, email: string) {
  const now = new Date()
  mockDb.authUser!.push({
    id,
    name: id,
    email,
    emailVerified: true,
    image: null,
    createdAt: now,
    updatedAt: now,
  })
}

beforeAll(async () => {
  for (const k of TOUCHED_ENV) savedEnv[k] = process.env[k]
  delete process.env.SMTP_URL
  delete process.env.SMTP_HOST
  delete process.env.RESEND_API_KEY
  Object.assign(process.env, {
    NODE_ENV: 'production',
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  })
  server = await import('@/lib/auth/better-auth/server')
})

afterAll(() => {
  const env = process.env as Record<string, string | undefined>
  for (const k of TOUCHED_ENV) {
    if (savedEnv[k] === undefined) delete env[k]
    else env[k] = savedEnv[k]
  }
  globalThis.lumoBetterAuth = undefined
})

beforeEach(() => {
  for (const rows of Object.values(mockDb)) rows.length = 0
  mockLogger.warn.mockClear()
})

describe('local sign-in endpoint (LUM-1335)', () => {
  it('does not exist without LUMO_MODE=local', async () => {
    const res = await signIn(rebuild({ LUMO_MODE: undefined }))
    expect(res.status).toBe(404)
    expect(mockDb.authUser).toHaveLength(0)
  })

  it('first visit creates the local user, signs in, and returns to the page', async () => {
    const instance = rebuild({ LUMO_MODE: 'local' })
    const res = await signIn(instance, '?redirect_url=%2Fworkspace%2Facme')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/workspace/acme')
    expect(mockDb.authUser).toHaveLength(1)
    expect(mockDb.authUser![0]).toMatchObject({
      email: 'local@lumo.localhost',
      name: 'Local user',
      emailVerified: true,
    })
    // An ordinary user id, like any other account's.
    expect(String(mockDb.authUser![0]!.id)).toMatch(/^user_/)
    const session = await instance.api.getSession({
      headers: new Headers({ cookie: cookieHeader(res) }),
    })
    expect(session?.user.id).toBe(mockDb.authUser![0]!.id)
  })

  it('later visits sign in as the same user, without creating another', async () => {
    const instance = rebuild({ LUMO_MODE: 'local' })
    await signIn(instance)
    const res = await signIn(instance)
    expect(res.status).toBe(302)
    expect(mockDb.authUser).toHaveLength(1)
    expect(mockDb.authSession).toHaveLength(2)
  })

  it('one existing account (signed up before) is the one signed in', async () => {
    seedUser('user_existing', 'me@example.test')
    const instance = rebuild({ LUMO_MODE: 'local' })
    const res = await signIn(instance)
    const session = await instance.api.getSession({
      headers: new Headers({ cookie: cookieHeader(res) }),
    })
    expect(session?.user.id).toBe('user_existing')
    expect(mockDb.authUser).toHaveLength(1)
  })

  it('refuses with 409 and signs nobody in when there are several accounts', async () => {
    seedUser('user_a', 'a@example.test')
    seedUser('user_b', 'b@example.test')
    const res = await signIn(rebuild({ LUMO_MODE: 'local' }))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      error: 'local_mode_multiple_users',
    })
    expect(res.headers.getSetCookie()).toHaveLength(0)
    expect(mockDb.authSession).toHaveLength(0)
  })

  it('never redirects off this origin', async () => {
    const res = await signIn(
      rebuild({ LUMO_MODE: 'local' }),
      '?redirect_url=https%3A%2F%2Fevil.example'
    )
    expect(res.headers.get('location')).toBe('/workspace')
  })

  it('warns at start-up when local mode is on a public URL, not on localhost', () => {
    rebuild({ LUMO_MODE: 'local' }, 'https://lumo.example.com')
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('LUMO_MODE=local on https://lumo.example.com')
    )
    mockLogger.warn.mockClear()
    rebuild({ LUMO_MODE: 'local' })
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining('LUMO_MODE')
    )
  })

  it('an unknown LUMO_MODE refuses to build the instance', () => {
    expect(() => rebuild({ LUMO_MODE: 'demo' })).toThrow(/LUMO_MODE "demo"/)
  })
})
