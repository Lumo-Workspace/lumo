/**
 * @jest-environment node
 *
 * LUM-1082 — email one-time-code sign-in and the password switch, through the
 * REAL Lumo Better Auth instance (lib/auth/better-auth/server.ts) and its HTTP
 * handler; only the Prisma adapter is Better Auth's in-memory adapter and
 * email delivery is a mock (nothing is sent).
 *
 * NODE_ENV is production (as in server-hardening.test.ts) so the rate limiter
 * is on, and RESEND_API_KEY is a dummy so the instance believes it can email.
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
const mockWaitUntil = jest.fn((_p: Promise<unknown>) => undefined)
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: Promise<unknown>) => mockWaitUntil(p),
}))
const mockLogger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
jest.mock('@/lib/logger', () => ({ logger: mockLogger }))

type Instance = { handler: (req: Request) => Promise<Response> }
type ServerModule = typeof import('@/lib/auth/better-auth/server')

let server: ServerModule
const TOUCHED_ENV = [
  'NODE_ENV',
  'AUTH_PROVIDER',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'RESEND_API_KEY',
  'SMTP_URL',
  'SMTP_HOST',
  'AUTH_DISABLE_PASSWORD',
  'AUTH_DISABLE_SIGNUP',
  'AUTH_GOOGLE_CLIENT_ID',
  'AUTH_GOOGLE_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
] as const
const savedEnv: Record<string, string | undefined> = {}
let warnSpy: jest.SpyInstance | undefined
let errorSpy: jest.SpyInstance | undefined

let ipCounter = 0
const nextIp = () => `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`

function post(
  instance: Instance,
  path: string,
  body: unknown,
  ip: string = nextIp()
): Promise<Response> {
  return instance.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        'x-forwarded-for': ip,
        'accept-language': 'de-DE,de;q=0.9',
      },
    })
  )
}

/** A fresh instance built from the current env. */
function rebuild(env: Partial<Record<(typeof TOUCHED_ENV)[number], string>>) {
  for (const k of [
    'AUTH_DISABLE_PASSWORD',
    'AUTH_DISABLE_SIGNUP',
    'AUTH_GOOGLE_CLIENT_ID',
    'AUTH_GOOGLE_CLIENT_SECRET',
    'GOOGLE_CLIENT_ID',
  ] as const) {
    delete process.env[k]
  }
  Object.assign(process.env, env)
  globalThis.lumoBetterAuth = undefined
  return server.getBetterAuth()
}

const freshEmail = (tag: string) =>
  `${tag}-${randomBytes(4).toString('hex')}@example.test`

/** The code in the last email handed to the mail layer. */
function lastCode(): string {
  const message = mockSendEmail.mock.calls[
    mockSendEmail.mock.calls.length - 1
  ]?.[0] as { text: string } | undefined
  const match = message?.text.match(/\b(\d{6})\b/)
  if (!match?.[1]) throw new Error('no code was emailed')
  return match[1]
}

async function sendCode(instance: Instance, email: string, ip?: string) {
  const res = await post(
    instance,
    '/email-otp/send-verification-otp',
    { email, type: 'sign-in' },
    ip
  )
  // The email goes out in the background (waitUntil); settle it.
  await Promise.all(mockWaitUntil.mock.calls.map(c => c[0]))
  return res
}

function seedImportedUser(id: string, email: string) {
  // As the Clerk import writes a code-only user: verified email, no password.
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
}

beforeAll(async () => {
  const clerkKeys = Object.keys(process.env).filter(k => k.includes('CLERK'))
  for (const k of [...TOUCHED_ENV, ...clerkKeys]) savedEnv[k] = process.env[k]
  for (const k of clerkKeys) delete process.env[k]
  delete process.env.SMTP_URL
  delete process.env.SMTP_HOST
  Object.assign(process.env, {
    NODE_ENV: 'production',
    AUTH_PROVIDER: 'better-auth',
    BETTER_AUTH_URL: BASE,
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    // Not a real key: email delivery is mocked above.
    RESEND_API_KEY: `dummy-${randomBytes(4).toString('hex')}`,
  })
  globalThis.lumoBetterAuth = undefined
  server = await import('@/lib/auth/better-auth/server')
})

afterAll(() => {
  globalThis.lumoBetterAuth = undefined
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

beforeEach(() => {
  // Better Auth logs every refused request; not useful here.
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
  mockWaitUntil.mockClear()
  mockSendEmail.mockReset()
  mockSendEmail.mockResolvedValue({ status: 'sent', id: 'msg_1' })
  mockLogger.warn.mockClear()
  mockLogger.info.mockClear()
})

afterEach(() => {
  warnSpy?.mockRestore()
  errorSpy?.mockRestore()
})

describe('email code sign-in (LUM-1082)', () => {
  it('an imported Clerk user (no password) signs in to the SAME account with an emailed code', async () => {
    const auth = rebuild({})
    const id = `user_clerk${randomBytes(6).toString('hex')}`
    const email = freshEmail('imported')
    seedImportedUser(id, email)

    const sent = await sendCode(auth, email)
    expect(sent.status).toBe(200)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const message = mockSendEmail.mock.calls[0]![0] as {
      to: string[]
      subject: string
    }
    expect(message.to).toEqual([email])
    // Localized from Accept-Language (de).
    expect(message.subject).toBe('Dein Lumo-Bestätigungscode')
    const code = lastCode()
    // Stored hashed: the database never holds the code itself.
    const row = mockDb.authVerification!.find(
      v => v.identifier === `sign-in-otp-${email}`
    )
    expect(String(row?.value)).not.toContain(code)

    const res = await post(auth, '/sign-in/email-otp', { email, otp: code })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    expect(body.user.id).toBe(id)
    expect(res.headers.getSetCookie().join(';')).toMatch(/session_token/)
    expect(mockDb.authUser!.filter(u => u.email === email)).toHaveLength(1)
  })

  it('a new email gets an account (user_ id, verified) in the same two steps', async () => {
    const auth = rebuild({})
    const email = freshEmail('new')
    await sendCode(auth, email)
    const res = await post(auth, '/sign-in/email-otp', {
      email,
      otp: lastCode(),
    })
    expect(res.status).toBe(200)
    const { user } = (await res.json()) as {
      user: { id: string; emailVerified: boolean }
    }
    expect(user.id).toMatch(/^user_/)
    expect(user.emailVerified).toBe(true)
  })

  it('a wrong code is refused; the third wrong try voids the code', async () => {
    const auth = rebuild({})
    const email = freshEmail('wrong')
    await sendCode(auth, email)
    const code = lastCode()
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 3; i++) {
      const res = await post(auth, '/sign-in/email-otp', { email, otp: wrong })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ code: 'INVALID_OTP' })
    }
    const late = await post(auth, '/sign-in/email-otp', { email, otp: code })
    expect(late.status).toBe(403)
    expect(await late.json()).toMatchObject({ code: 'TOO_MANY_ATTEMPTS' })
  })

  it('an expired code is refused with OTP_EXPIRED', async () => {
    const auth = rebuild({})
    const email = freshEmail('expired')
    await sendCode(auth, email)
    const code = lastCode()
    const row = mockDb.authVerification!.find(
      v => v.identifier === `sign-in-otp-${email}`
    )!
    // Codes live 10 minutes.
    const ttlMs =
      (row.expiresAt as Date).getTime() - (row.createdAt as Date).getTime()
    expect(Math.round(ttlMs / 60_000)).toBe(10)
    row.expiresAt = new Date(Date.now() - 1000)
    const res = await post(auth, '/sign-in/email-otp', { email, otp: code })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'OTP_EXPIRED' })
  })

  it('rate limits sending: the 4th code request from one IP within a minute is 429', async () => {
    const auth = rebuild({})
    const ip = '10.9.9.9'
    for (let i = 0; i < 3; i++) {
      const res = await sendCode(auth, freshEmail('rl'), ip)
      expect(res.status).toBe(200)
    }
    const limited = await sendCode(auth, freshEmail('rl'), ip)
    expect(limited.status).toBe(429)
    // Counted in the shared database store (LUM-1070).
    expect(
      mockDb.authRateLimit!.some(r =>
        String(r.key).includes('/email-otp/send-verification-otp')
      )
    ).toBe(true)
  })

  it('with sign-up closed, an unknown email gets the same answer, no email, and no way in', async () => {
    const auth = rebuild({ AUTH_DISABLE_SIGNUP: 'true' })
    const known = freshEmail('known')
    seedImportedUser(`user_k${randomBytes(6).toString('hex')}`, known)
    const unknown = freshEmail('unknown')

    const a = await sendCode(auth, known)
    const b = await sendCode(auth, unknown)
    expect(a.status).toBe(b.status)
    expect(await a.json()).toEqual(await b.json())
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail.mock.calls[0]![0]).toMatchObject({ to: [known] })

    const res = await post(auth, '/sign-in/email-otp', {
      email: unknown,
      otp: '123456',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'INVALID_OTP' })
    expect(mockDb.authUser!.some(u => u.email === unknown)).toBe(false)
  })

  it('answers before the email is sent (background), so timing does not reveal the account', async () => {
    const auth = rebuild({})
    const email = freshEmail('slow')
    seedImportedUser(`user_s${randomBytes(6).toString('hex')}`, email)
    let release: () => void = () => undefined
    mockSendEmail.mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve({ status: 'sent', id: 'm' })
        })
    )
    const res = await post(auth, '/email-otp/send-verification-otp', {
      email,
      type: 'sign-in',
    })
    expect(res.status).toBe(200)
    expect(mockWaitUntil).toHaveBeenCalled()
    release()
    await Promise.all(mockWaitUntil.mock.calls.map(c => c[0]))
  })

  it('an existing UNVERIFIED account is not taken over by code: refused like a wrong code, nothing changed', async () => {
    const auth = rebuild({})
    const id = `user_u${randomBytes(6).toString('hex')}`
    const email = freshEmail('unverified')
    const now = new Date()
    mockDb.authUser!.push({
      id,
      name: 'Someone',
      email,
      emailVerified: false,
      image: null,
      firstName: 'Someone',
      lastName: null,
      createdAt: now,
      updatedAt: now,
    })
    mockDb.authAccount!.push({
      id: `acc-${id}`,
      accountId: id,
      providerId: 'credential',
      userId: id,
      password: 'unused',
      createdAt: now,
      updatedAt: now,
    })
    await sendCode(auth, email)
    const res = await post(auth, '/sign-in/email-otp', {
      email,
      otp: lastCode(),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ code: 'INVALID_OTP' })
    expect(res.headers.getSetCookie().join(';')).not.toMatch(/session_token/)
    expect(mockDb.authUser!.find(u => u.id === id)?.emailVerified).toBe(false)
    expect(mockDb.authAccount!.some(a => a.userId === id)).toBe(true)
    expect(mockDb.authSession!.some(s => s.userId === id)).toBe(false)
  })

  it('the plugin password-reset / change-email endpoints are disabled', async () => {
    const auth = rebuild({})
    for (const path of [
      '/email-otp/request-password-reset',
      '/email-otp/reset-password',
      '/forget-password/email-otp',
      '/email-otp/request-email-change',
      '/email-otp/change-email',
    ]) {
      const res = await post(auth, path, { email: freshEmail('x') })
      expect(res.status).toBe(404)
    }
  })
})

describe('password switch (LUM-1082)', () => {
  it('AUTH_DISABLE_PASSWORD=true: no password sign-in / sign-up / reset / change; config says so', async () => {
    const auth = rebuild({ AUTH_DISABLE_PASSWORD: 'true' })
    const email = freshEmail('nopw')
    const signUp = await post(auth, '/sign-up/email', {
      name: 'N',
      email,
      password: `pw-${randomBytes(9).toString('base64url')}`,
    })
    expect(signUp.status).toBe(400)
    const signIn = await post(auth, '/sign-in/email', {
      email,
      password: `pw-${randomBytes(9).toString('base64url')}`,
    })
    expect(signIn.status).toBe(400)
    for (const path of [
      '/request-password-reset',
      '/reset-password',
      '/change-password',
    ]) {
      expect((await post(auth, path, { email })).status).toBe(404)
    }
    const config = await auth.handler(
      new Request(`${BASE}/api/auth/lumo/config`, {
        headers: { origin: BASE, 'x-forwarded-for': nextIp() },
      })
    )
    expect(await config.json()).toMatchObject({
      passwordEnabled: false,
      emailCodeEnabled: true,
    })
    // The email code still signs in.
    await sendCode(auth, email)
    const res = await post(auth, '/sign-in/email-otp', {
      email,
      otp: lastCode(),
    })
    expect(res.status).toBe(200)
  })

  it('default (unset): password sign-up and the reset request still work', async () => {
    const auth = rebuild({})
    const email = freshEmail('pw')
    const up = await post(auth, '/sign-up/email', {
      name: 'P',
      email,
      password: `pw-${randomBytes(9).toString('base64url')}`,
    })
    expect(up.status).toBe(200)
    const reset = await post(auth, '/request-password-reset', {
      email,
      redirectTo: '/reset-password',
    })
    expect(reset.status).toBe(200)
  })
})

describe('Google client separation warning (LUM-1082)', () => {
  const googleWarned = () =>
    mockLogger.warn.mock.calls.some(c =>
      String(c[0]).includes('AUTH_GOOGLE_CLIENT_ID')
    )

  it('warns (without the id) when sign-in reuses the Drive client', () => {
    const id = `${randomBytes(6).toString('hex')}.apps.googleusercontent.com`
    rebuild({
      AUTH_GOOGLE_CLIENT_ID: id,
      AUTH_GOOGLE_CLIENT_SECRET: randomBytes(8).toString('hex'),
      GOOGLE_CLIENT_ID: id,
    })
    expect(googleWarned()).toBe(true)
    expect(JSON.stringify(mockLogger.warn.mock.calls)).not.toContain(id)
  })

  it('stays quiet when the clients differ', () => {
    rebuild({
      AUTH_GOOGLE_CLIENT_ID: 'signin.apps.googleusercontent.com',
      AUTH_GOOGLE_CLIENT_SECRET: randomBytes(8).toString('hex'),
      GOOGLE_CLIENT_ID: 'drive.apps.googleusercontent.com',
    })
    expect(googleWarned()).toBe(false)
  })
})
