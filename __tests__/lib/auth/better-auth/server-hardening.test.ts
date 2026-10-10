/**
 * @jest-environment node
 *
 * LUM-1070 — Better Auth production hardening, through the REAL Lumo
 * instance (lib/auth/better-auth/server.ts → getBetterAuth) and its real HTTP
 * handler. Only the Prisma adapter is swapped for Better Auth's in-memory
 * adapter, so this runs on every `npm test`; the Postgres version is the
 * opt-in __tests__/integration/better-auth.hardening.test.ts.
 *
 *   - bcrypt hashes imported from Clerk sign in ($2a$ / $2b$ / $2y$)
 *   - forgot → reset password (localized email) and change password
 *   - new user ids start with `user_`
 *   - rate limits are counted in the shared database store: two instances
 *     over one database share a bucket
 *   - the account-linking policy trusts no provider
 *
 * NODE_ENV is set to production before Better Auth loads: its rate limiter
 * is only on in production, and that is what this suite must prove.
 */
import { randomBytes } from 'node:crypto'

const BASE = 'http://localhost:3000'

// One in-memory "database" shared by every instance built in this file —
// the stand-in for the Postgres all Vercel instances share.
const mockDb: Record<string, Array<Record<string, unknown>>> = {}
for (const t of [
  'authUser',
  'authSession',
  'authAccount',
  'authVerification',
  'authRateLimit',
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
const mockSendEmail = jest.fn()
jest.mock('@/lib/integrations/email/client', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

type Instance = { handler: (req: Request) => Promise<Response> }
type ServerModule = typeof import('@/lib/auth/better-auth/server')

let server: ServerModule
let bcrypt: typeof import('bcryptjs')
const savedEnv = { ...process.env }

// Each request gets its own client IP unless a test pins one, so the
// sign-in limit (3 per 10 s per IP + path) only bites where it is tested.
let ipCounter = 0
const nextIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`

function call(
  instance: Instance,
  path: string,
  init: RequestInit & { ip?: string } = {}
): Promise<Response> {
  const { ip, headers, ...rest } = init
  return instance.handler(
    new Request(`${BASE}/api/auth${path}`, {
      ...rest,
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        'x-forwarded-for': ip ?? nextIp(),
        ...(headers as Record<string, string> | undefined),
      },
    })
  )
}

const post = (
  instance: Instance,
  path: string,
  body: unknown,
  extra: { ip?: string; headers?: Record<string, string> } = {}
) =>
  call(instance, path, { method: 'POST', body: JSON.stringify(body), ...extra })

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ')
}

/** A user as the Clerk import (LUM-1069 T3) writes it: id + bcrypt hash. */
async function seedImportedUser(
  id: string,
  email: string,
  password: string,
  prefix: '$2a$' | '$2b$' | '$2y$'
) {
  // bcryptjs emits $2b$; $2a$/$2y$ digests are byte-identical apart from the
  // version letter, which is exactly how Clerk exports may vary.
  const hash = prefix + (await bcrypt.hash(password, 4)).slice(4)
  const now = new Date()
  mockDb.authUser!.push({
    id,
    name: 'Imported User',
    email,
    emailVerified: true,
    image: null,
    firstName: 'Imported',
    lastName: 'User',
    createdAt: now,
    updatedAt: now,
  })
  mockDb.authAccount!.push({
    id: `clerk-${id}-credential`,
    accountId: id,
    providerId: 'credential',
    userId: id,
    password: hash,
    createdAt: now,
    updatedAt: now,
  })
  return hash
}

const credentialHashOf = (userId: string) =>
  mockDb.authAccount!.find(
    a => a.userId === userId && a.providerId === 'credential'
  )?.password as string | undefined

const freshPassword = () => `pw-${randomBytes(9).toString('base64url')}`

beforeAll(async () => {
  for (const k of Object.keys(process.env)) {
    if (k.includes('CLERK')) delete process.env[k]
  }
  Object.assign(process.env, {
    NODE_ENV: 'production',
    AUTH_PROVIDER: 'better-auth',
    BETTER_AUTH_URL: BASE,
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
  })
  delete globalThis.lumoBetterAuth
  server = await import('@/lib/auth/better-auth/server')
  bcrypt = await import('bcryptjs')
})

afterEach(() => {
  jest.restoreAllMocks()
})

afterAll(() => {
  delete globalThis.lumoBetterAuth
  process.env = savedEnv
})

beforeEach(() => {
  // Better Auth logs every refused sign-in; not useful here.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  mockSendEmail.mockReset()
  mockSendEmail.mockResolvedValue({ status: 'sent', id: 'msg_1' })
})

describe('new user ids (LUM-1070)', () => {
  it('a sign-up gets a user_ id; sessions and accounts keep plain ids', async () => {
    const auth = server.getBetterAuth()
    const email = `new-${randomBytes(4).toString('hex')}@example.test`
    const res = await post(auth, '/sign-up/email', {
      name: 'Grace Hopper',
      email,
      password: freshPassword(),
    })
    expect(res.status).toBe(200)
    const { user } = (await res.json()) as { user: { id: string } }
    expect(user.id).toMatch(/^user_[A-Za-z0-9]{32}$/)
    const account = mockDb.authAccount!.find(a => a.userId === user.id)
    const session = mockDb.authSession!.find(s => s.userId === user.id)
    expect(String(account?.id)).not.toMatch(/^user_/)
    expect(String(session?.id)).not.toMatch(/^user_/)
  })
})

describe('bcrypt hashes imported from Clerk (LUM-1070)', () => {
  it.each(['$2a$', '$2b$', '$2y$'] as const)(
    'a %s account signs in; a wrong password is refused; the hash is not rewritten',
    async prefix => {
      const auth = server.getBetterAuth()
      const id = `user_clerk${randomBytes(6).toString('hex')}`
      const email = `${id}@example.test`
      const password = freshPassword()
      const hash = await seedImportedUser(id, email, password, prefix)

      const wrong = await post(auth, '/sign-in/email', {
        email,
        password: `${password}x`,
      })
      expect(wrong.status).toBe(401)

      const ok = await post(auth, '/sign-in/email', { email, password })
      expect(ok.status).toBe(200)
      const body = (await ok.json()) as { user: { id: string } }
      expect(body.user.id).toBe(id)
      expect(credentialHashOf(id)).toBe(hash)
    }
  )

  it('scrypt passwords (Better Auth default) keep working', async () => {
    const auth = server.getBetterAuth()
    const email = `scrypt-${randomBytes(4).toString('hex')}@example.test`
    const password = freshPassword()
    const up = await post(auth, '/sign-up/email', {
      name: 'S',
      email,
      password,
    })
    const { user } = (await up.json()) as { user: { id: string } }
    expect(credentialHashOf(user.id)).not.toMatch(/^\$2[aby]\$/)
    const res = await post(auth, '/sign-in/email', { email, password })
    expect(res.status).toBe(200)
  })
})

describe('forgot / reset / change password (LUM-1070)', () => {
  it('reset: localized email → link → new password; old one stops working, sessions revoked, hash becomes scrypt', async () => {
    const auth = server.getBetterAuth()
    const id = `user_clerk${randomBytes(6).toString('hex')}`
    const email = `${id}@example.test`
    const oldPassword = freshPassword()
    await seedImportedUser(id, email, oldPassword, '$2a$')
    const signedIn = await post(auth, '/sign-in/email', {
      email,
      password: oldPassword,
    })
    expect(signedIn.status).toBe(200)
    expect(mockDb.authSession!.some(s => s.userId === id)).toBe(true)

    const requested = await post(
      auth,
      '/request-password-reset',
      { email, redirectTo: '/reset-password' },
      { headers: { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.5' } }
    )
    expect(requested.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const message = mockSendEmail.mock.calls[0]![0] as {
      to: string[]
      subject: string
      text: string
    }
    expect(message.to).toEqual([email])
    expect(message.subject).toBe('重置你的 Lumo 密码')
    const link = message.text.match(/https?:\/\/\S+/)![0]
    expect(link).toContain('/api/auth/reset-password/')

    // The emailed link redirects to the reset page with the token.
    const landing = await auth.handler(
      new Request(link, { headers: { 'x-forwarded-for': nextIp() } })
    )
    expect(landing.status).toBe(302)
    const target = new URL(landing.headers.get('location')!, BASE)
    expect(target.pathname).toBe('/reset-password')
    const token = target.searchParams.get('token')!
    expect(token).toBeTruthy()

    const newPassword = freshPassword()
    const reset = await post(auth, '/reset-password', { newPassword, token })
    expect(reset.status).toBe(200)
    expect(credentialHashOf(id)).not.toMatch(/^\$2[aby]\$/)
    expect(mockDb.authSession!.some(s => s.userId === id)).toBe(false)

    const old = await post(auth, '/sign-in/email', {
      email,
      password: oldPassword,
    })
    expect(old.status).toBe(401)
    const fresh = await post(auth, '/sign-in/email', {
      email,
      password: newPassword,
    })
    expect(fresh.status).toBe(200)

    // A used token cannot be replayed.
    const replay = await post(auth, '/reset-password', {
      newPassword: freshPassword(),
      token,
    })
    expect(replay.status).toBe(400)
  })

  it('reset request for an unknown email answers the same and sends nothing', async () => {
    const auth = server.getBetterAuth()
    const res = await post(auth, '/request-password-reset', {
      email: `nobody-${randomBytes(4).toString('hex')}@example.test`,
      redirectTo: '/reset-password',
    })
    expect(res.status).toBe(200)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('an expired or unknown reset link lands on the page with INVALID_TOKEN', async () => {
    const auth = server.getBetterAuth()
    const res = await call(
      auth,
      '/reset-password/not-a-token?callbackURL=%2Freset-password'
    )
    expect(res.status).toBe(302)
    const target = new URL(res.headers.get('location')!, BASE)
    expect(target.pathname).toBe('/reset-password')
    expect(target.searchParams.get('error')).toBe('INVALID_TOKEN')
  })

  it('change password: needs the current one, then only the new one works', async () => {
    const auth = server.getBetterAuth()
    const id = `user_clerk${randomBytes(6).toString('hex')}`
    const email = `${id}@example.test`
    const current = freshPassword()
    await seedImportedUser(id, email, current, '$2b$')
    const signIn = await post(auth, '/sign-in/email', {
      email,
      password: current,
    })
    const cookie = cookieOf(signIn)
    const next = freshPassword()

    const refused = await post(
      auth,
      '/change-password',
      { currentPassword: `${current}x`, newPassword: next },
      { headers: { cookie } }
    )
    expect(refused.status).toBe(400)
    await expect(refused.json()).resolves.toMatchObject({
      code: 'INVALID_PASSWORD',
    })

    const changed = await post(
      auth,
      '/change-password',
      {
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: true,
      },
      { headers: { cookie } }
    )
    expect(changed.status).toBe(200)
    expect(credentialHashOf(id)).not.toMatch(/^\$2[aby]\$/)
    expect(
      (await post(auth, '/sign-in/email', { email, password: current })).status
    ).toBe(401)
    expect(
      (await post(auth, '/sign-in/email', { email, password: next })).status
    ).toBe(200)
  })
})

describe('database rate limiting across instances (LUM-1070)', () => {
  it('two instances over one database share the sign-in bucket; the 4th attempt is 429', async () => {
    const first = server.getBetterAuth()
    delete globalThis.lumoBetterAuth
    const second = server.getBetterAuth()
    expect(second).not.toBe(first)

    const ip = '203.0.113.7'
    const attempt = (instance: Instance) =>
      post(
        instance,
        '/sign-in/email',
        { email: 'nobody@example.test', password: freshPassword() },
        { ip }
      )
    // Alternate instances. (Better Auth's memory store is a module-level Map,
    // so in ONE process it would also be shared — the rows asserted below
    // are what prove the counter lives in the database, where separate
    // processes / Vercel instances see it too.)
    expect((await attempt(first)).status).toBe(401)
    expect((await attempt(second)).status).toBe(401)
    expect((await attempt(first)).status).toBe(401)
    const limited = await attempt(second)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('x-retry-after')).toBeTruthy()

    const rows = mockDb.authRateLimit!.filter(r => String(r.key).includes(ip))
    expect(rows).toHaveLength(1)
    expect(String(rows[0]!.key)).toContain('/sign-in/email')
    expect(rows[0]!.count).toBe(3)
    expect(typeof rows[0]!.lastRequest).toBe('number')
  })
})

describe('account linking policy (LUM-1070)', () => {
  it('trusts no provider, keeps emails equal, and requires local verification', async () => {
    const auth = server.getBetterAuth()
    expect(auth.options.account?.accountLinking).toEqual({
      enabled: true,
      trustedProviders: [],
      allowDifferentEmails: false,
    })
    const ctx = await auth.$context
    expect(ctx.trustedProviders).not.toContain('github')
    expect(ctx.trustedProviders).not.toContain('google')
    // requireLocalEmailVerified is left at Better Auth's default (true).
    expect(
      auth.options.account?.accountLinking?.requireLocalEmailVerified
    ).toBeUndefined()
  })
})
