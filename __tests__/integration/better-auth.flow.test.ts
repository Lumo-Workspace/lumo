/**
 * @jest-environment node
 *
 * LUM-1027 — end-to-end auth flow on a REAL Postgres through the REAL Better
 * Auth handler, with AUTH_PROVIDER=better-auth and no CLERK_* variable:
 *
 *   sign-up → sign-in → session → requireAuth → create workspace (real route
 *   + service) → membership helpers → user directory → API key (the CLI
 *   login path) → sign-out.
 *
 * Opt-in: set BETTER_AUTH_TEST_DATABASE_URL to a THROWAWAY migrated database
 * (e.g. a local pgvector container + `prisma migrate deploy`); it writes rows.
 */
import { createHash, randomBytes } from 'node:crypto'

const DB_URL = process.env.BETTER_AUTH_TEST_DATABASE_URL
const describeDb = DB_URL ? describe : describe.skip

// Request-scoped headers for next/headers (what a route handler would see).
let requestHeaders = new Headers()
jest.mock('next/headers', () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}))

// jest.setup.js stubs PrismaClient for every suite; this one needs the real one.
jest.unmock('@prisma/client')

// The workspace route's service barrel reaches the GitHub App client, whose
// Octokit deps are ESM-only; nothing here talks to GitHub.
jest.mock('@/lib/integrations/github/auth', () => ({}))

const BASE = 'http://localhost:3000'
const run = randomBytes(4).toString('hex')
const email = `lum1027-${run}@example.test`
// Throwaway password generated per run, never reused.
const password = `pw-${randomBytes(12).toString('base64url')}`

function cookieHeader(res: Response): string {
  return res.headers
    .getSetCookie()
    .map(c => c.split(';')[0])
    .join('; ')
}

describeDb('Better Auth flow on a real database (LUM-1027)', () => {
  // Loaded after the env is set, so Prisma connects to the test database.
  let mod: {
    handleAuthRequest: typeof import('@/lib/auth/handler').handleAuthRequest
    auth: typeof import('@/lib/auth')
    users: typeof import('@/lib/auth/users')
    createWorkspace: typeof import('@/app/api/workspaces/route').POST
    prisma: typeof import('@/lib/db/prisma').prisma
  }
  let userId = ''
  let sessionCookie = ''
  let workspaceId = ''

  const call = (path: string, init: RequestInit = {}) =>
    mod.handleAuthRequest(
      new Request(`${BASE}/api/auth${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          origin: BASE,
          ...(init.headers ?? {}),
        },
      })
    )

  beforeAll(async () => {
    for (const k of Object.keys(process.env)) {
      if (k.includes('CLERK')) delete process.env[k]
    }
    process.env.DATABASE_URL = DB_URL
    process.env.AUTH_PROVIDER = 'better-auth'
    process.env.BETTER_AUTH_URL = BASE
    process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('base64')
    mod = {
      handleAuthRequest: (await import('@/lib/auth/handler')).handleAuthRequest,
      auth: await import('@/lib/auth'),
      users: await import('@/lib/auth/users'),
      createWorkspace: (await import('@/app/api/workspaces/route')).POST,
      prisma: (await import('@/lib/db/prisma')).prisma,
    }
  })

  afterAll(async () => {
    if (!mod) return
    if (workspaceId) {
      await mod.prisma.workspace.deleteMany({ where: { id: workspaceId } })
    }
    await mod.prisma.authUser.deleteMany({ where: { email } })
    await mod.prisma.$disconnect()
  })

  it('signs up with email + password (and writes the derived name columns)', async () => {
    const res = await call('/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ada Lovelace', email, password }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string } }
    userId = body.user.id
    expect(userId).toBeTruthy()
    const row = await mod.prisma.authUser.findUnique({ where: { id: userId } })
    expect(row).toMatchObject({
      email,
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      emailVerified: false,
    })
  })

  it('serves the public sign-in config (no secrets)', async () => {
    const res = await call('/lumo/config')
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      socialProviders: [],
      signUpEnabled: true,
    })
  })

  it('rejects a wrong password and a duplicate sign-up', async () => {
    const wrong = await call('/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password: `${password}x` }),
    })
    expect(wrong.status).toBe(401)
    const dup = await call('/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ name: 'Again', email, password }),
    })
    expect(dup.status).toBe(422)
  })

  it('signs in and the session resolves through @/lib/auth', async () => {
    const res = await call('/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    expect(res.status).toBe(200)
    sessionCookie = cookieHeader(res)
    expect(sessionCookie).toContain('better-auth.session_token=')

    requestHeaders = new Headers({ cookie: sessionCookie })
    await expect(mod.auth.getCurrentUserId()).resolves.toBe(userId)
    await expect(mod.auth.requireAuth()).resolves.toEqual({ userId })
    const user = await mod.auth.getCurrentUser()
    expect(user).toMatchObject({
      id: userId,
      firstName: 'Ada',
      lastName: 'Lovelace',
      primaryEmailAddress: { emailAddress: email },
    })
    // Unverified email grants no invite access.
    await expect(mod.auth.getVerifiedEmails()).resolves.toEqual([])
  })

  it('an anonymous request is a 401 from requireAuth', async () => {
    requestHeaders = new Headers()
    const res = await mod.auth.requireAuth()
    expect((res as Response).status).toBe(401)
  })

  it('creates a workspace through the real route and resolves membership', async () => {
    requestHeaders = new Headers({ cookie: sessionCookie })
    const { NextRequest } = await import('next/server')
    const res = await mod.createWorkspace(
      new NextRequest(`${BASE}/api/workspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `LUM1027 ${run}`,
          slug: `lum1027-${run}`,
        }),
      })
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      workspace: { id: string; slug: string }
      member: { clerkId: string; role: string }
    }
    workspaceId = body.workspace.id
    // The Better Auth user id lives in the existing identity column.
    expect(body.member).toMatchObject({ clerkId: userId, role: 'OWNER' })

    const member = await mod.auth.requireWorkspaceMember(workspaceId, userId)
    expect(member).toMatchObject({ workspaceId, clerkId: userId })
    await expect(mod.auth.getUserWorkspace(userId)).resolves.toMatchObject({
      workspaceId,
    })
    const stranger = await mod.auth.requireWorkspaceMembership(
      workspaceId,
      'someone-else'
    )
    expect((stranger as Response).status).toBe(403)
  })

  it('user directory reads and updates the Better Auth user', async () => {
    const dir = await mod.users.getUserDirectory()
    const { data } = await dir.getUserList({
      userId: [userId, 'missing-id'],
      emailAddress: [email.toUpperCase()],
      limit: 10,
    })
    expect(data.map(u => u.id)).toEqual([userId])
    await dir.updateUser(userId, { firstName: 'Augusta' })
    await expect(dir.getUser(userId)).resolves.toMatchObject({
      firstName: 'Augusta',
      lastName: 'Lovelace',
    })
    await expect(dir.getUser('missing-id')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('API keys (lumo auth login) authenticate the Better Auth user', async () => {
    const member = await mod.prisma.workspaceMember.findFirstOrThrow({
      where: { workspaceId, clerkId: userId },
    })
    const token = `lum_${randomBytes(24).toString('hex')}`
    await mod.prisma.apiKey.create({
      data: {
        workspaceMemberId: member.id,
        label: 'lum1027 test',
        keyHash: createHash('sha256').update(token).digest('hex'),
        keyPrefix: token.slice(0, 16),
      },
    })
    requestHeaders = new Headers()
    const identity = await mod.auth.requireIdentity(
      new Request(`${BASE}/api/tasks`, {
        headers: { authorization: `Bearer ${token}` },
      })
    )
    expect(identity).toMatchObject({
      clerkId: userId,
      memberId: member.id,
      workspaceId,
      source: 'bearer',
    })
  })

  it('signs out: the session no longer resolves', async () => {
    const res = await call('/sign-out', {
      method: 'POST',
      headers: { cookie: sessionCookie },
      body: '{}',
    })
    expect(res.status).toBe(200)
    // The browser drops the cookie cache on sign-out; replay the token only.
    const tokenOnly = sessionCookie
      .split('; ')
      .filter(c => c.startsWith('better-auth.session_token='))
      .join('; ')
    requestHeaders = new Headers({ cookie: tokenOnly })
    await expect(mod.auth.getCurrentUserId()).resolves.toBeNull()
    expect(
      res.headers.getSetCookie().some(c => /session_token=;|Max-Age=0/i.test(c))
    ).toBe(true)
  })
})
