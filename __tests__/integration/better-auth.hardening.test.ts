/**
 * @jest-environment node
 *
 * LUM-1070 — Better Auth hardening on a REAL Postgres through the REAL Lumo
 * instance and handler (AUTH_PROVIDER=better-auth, no CLERK_* variable):
 * bcrypt sign-in, forgot → reset password, change password, `user_` ids, and
 * the database rate limiter shared by two instances (rows in
 * `auth_rate_limits`). The always-on twin on the in-memory adapter is
 * __tests__/lib/auth/better-auth/server-hardening.test.ts.
 *
 * Opt-in: set BETTER_AUTH_TEST_DATABASE_URL to a THROWAWAY migrated database
 * (e.g. a local pgvector container + `prisma migrate deploy`); it writes rows.
 */
import { randomBytes } from 'node:crypto'

const DB_URL = process.env.BETTER_AUTH_TEST_DATABASE_URL
const describeDb = DB_URL ? describe : describe.skip

// jest.setup.js stubs PrismaClient for every suite; this one needs the real one.
jest.unmock('@prisma/client')

const mockSendEmail = jest.fn()
jest.mock('@/lib/integrations/email/client', () => ({
  sendEmail: (...a: unknown[]) => mockSendEmail(...a),
}))

const BASE = 'http://localhost:3000'
const run = randomBytes(4).toString('hex')
const emailOf = (tag: string) => `lum1070-${tag}-${run}@example.test`
const freshPassword = () => `pw-${randomBytes(9).toString('base64url')}`

type Instance = { handler: (req: Request) => Promise<Response> }

let ipCounter = 0
const nextIp = () => `10.70.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`

function post(
  instance: Instance,
  path: string,
  body: unknown,
  extra: { ip?: string; headers?: Record<string, string> } = {}
) {
  return instance.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        'x-forwarded-for': extra.ip ?? nextIp(),
        ...(extra.headers ?? {}),
      },
    })
  )
}

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ')

describeDb('Better Auth hardening on a real database (LUM-1070)', () => {
  let server: typeof import('@/lib/auth/better-auth/server')
  let prisma: typeof import('@/lib/db/prisma').prisma
  let bcrypt: typeof import('bcryptjs')
  // Only the env keys this suite touches are saved and put back.
  const savedEnv: Record<string, string | undefined> = {}
  const emails: string[] = []
  const rateLimitIp = `198.51.100.${(parseInt(run, 16) % 200) + 1}`

  const credentialHash = async (userId: string) =>
    (
      await prisma.authAccount.findFirst({
        where: { userId, providerId: 'credential' },
        select: { password: true },
      })
    )?.password

  async function seedBcryptUser(tag: string, password: string) {
    const id = `user_lum1070${tag}${run}`
    const email = emailOf(tag)
    emails.push(email)
    await prisma.authUser.create({
      data: {
        id,
        name: 'Imported User',
        email,
        emailVerified: true,
        firstName: 'Imported',
        lastName: 'User',
        accounts: {
          create: {
            id: `clerk-${id}-credential`,
            accountId: id,
            providerId: 'credential',
            password: await bcrypt.hash(password, 4),
          },
        },
      },
    })
    return { id, email }
  }

  beforeAll(async () => {
    const clerkKeys = Object.keys(process.env).filter(k => k.includes('CLERK'))
    const touched = [
      'DATABASE_URL',
      'NODE_ENV',
      'AUTH_PROVIDER',
      'BETTER_AUTH_URL',
      'BETTER_AUTH_SECRET',
    ]
    for (const k of [...touched, ...clerkKeys]) savedEnv[k] = process.env[k]
    for (const k of clerkKeys) delete process.env[k]
    Object.assign(process.env, {
      DATABASE_URL: DB_URL,
      // Better Auth only rate-limits in production.
      NODE_ENV: 'production',
      AUTH_PROVIDER: 'better-auth',
      BETTER_AUTH_URL: BASE,
      BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
    })
    globalThis.lumoBetterAuth = undefined
    server = await import('@/lib/auth/better-auth/server')
    prisma = (await import('@/lib/db/prisma')).prisma
    bcrypt = await import('bcryptjs')
  })

  afterAll(async () => {
    globalThis.lumoBetterAuth = undefined
    if (prisma) {
      await prisma.authUser.deleteMany({ where: { email: { in: emails } } })
      await prisma.authRateLimit.deleteMany({
        where: { key: { contains: rateLimitIp } },
      })
      await prisma.$disconnect()
    }
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  beforeEach(() => {
    mockSendEmail.mockReset()
    mockSendEmail.mockResolvedValue({ status: 'sent', id: 'msg_1' })
  })

  it('a new sign-up gets a user_ id', async () => {
    const email = emailOf('signup')
    emails.push(email)
    const res = await post(server.getBetterAuth(), '/sign-up/email', {
      name: 'Grace Hopper',
      email,
      password: freshPassword(),
    })
    expect(res.status).toBe(200)
    const { user } = (await res.json()) as { user: { id: string } }
    expect(user.id).toMatch(/^user_[A-Za-z0-9]{32}$/)
    const row = await prisma.authUser.findUnique({ where: { id: user.id } })
    expect(row?.email).toBe(email)
  })

  it('a bcrypt (Clerk-exported) account signs in; the hash is kept', async () => {
    const password = freshPassword()
    const { id, email } = await seedBcryptUser('bcrypt', password)
    const before = await credentialHash(id)
    const auth = server.getBetterAuth()
    expect(
      (await post(auth, '/sign-in/email', { email, password: `${password}x` }))
        .status
    ).toBe(401)
    const ok = await post(auth, '/sign-in/email', { email, password })
    expect(ok.status).toBe(200)
    expect(await credentialHash(id)).toBe(before)
  })

  it('forgot → reset password, then change password', async () => {
    const oldPassword = freshPassword()
    const { id, email } = await seedBcryptUser('reset', oldPassword)
    const auth = server.getBetterAuth()

    const requested = await post(
      auth,
      '/request-password-reset',
      { email, redirectTo: '/reset-password' },
      { headers: { 'accept-language': 'de-DE,de;q=0.9' } }
    )
    expect(requested.status).toBe(200)
    const message = mockSendEmail.mock.calls[0]![0] as {
      subject: string
      text: string
    }
    expect(message.subject).toBe('Setze dein Lumo-Passwort zurück')
    const link = message.text.match(/https?:\/\/\S+/)![0]
    const landing = await auth.handler(
      new Request(link, { headers: { 'x-forwarded-for': nextIp() } })
    )
    expect(landing.status).toBe(302)
    const token = new URL(
      landing.headers.get('location')!,
      BASE
    ).searchParams.get('token')!

    const reset = freshPassword()
    expect(
      (await post(auth, '/reset-password', { newPassword: reset, token }))
        .status
    ).toBe(200)
    expect(await credentialHash(id)).not.toMatch(/^\$2[aby]\$/)
    expect(
      (await post(auth, '/sign-in/email', { email, password: oldPassword }))
        .status
    ).toBe(401)
    const signedIn = await post(auth, '/sign-in/email', {
      email,
      password: reset,
    })
    expect(signedIn.status).toBe(200)

    const changed = freshPassword()
    const res = await post(
      auth,
      '/change-password',
      {
        currentPassword: reset,
        newPassword: changed,
        revokeOtherSessions: true,
      },
      { headers: { cookie: cookieOf(signedIn) } }
    )
    expect(res.status).toBe(200)
    expect(
      (await post(auth, '/sign-in/email', { email, password: changed })).status
    ).toBe(200)
  })

  it('two instances share the sign-in limit through auth_rate_limits', async () => {
    const first = server.getBetterAuth()
    globalThis.lumoBetterAuth = undefined
    const second = server.getBetterAuth()
    expect(second).not.toBe(first)
    const attempt = (instance: Instance) =>
      post(
        instance,
        '/sign-in/email',
        { email: emailOf('nobody'), password: freshPassword() },
        { ip: rateLimitIp }
      )
    expect((await attempt(first)).status).toBe(401)
    expect((await attempt(second)).status).toBe(401)
    expect((await attempt(first)).status).toBe(401)
    expect((await attempt(second)).status).toBe(429)

    const rows = await prisma.authRateLimit.findMany({
      where: { key: { contains: rateLimitIp } },
      select: { key: true, count: true, lastRequest: true },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.key).toContain('/sign-in/email')
    expect(rows[0]!.count).toBe(3)
    expect(Number(rows[0]!.lastRequest)).toBeGreaterThan(Date.now() - 60_000)
  })
})
