/**
 * @jest-environment node
 *
 * LUM-1071 — ban / unban / remove in Better Auth mode against a REAL Postgres
 * (every migration replayed into PGlite, including the admin-plugin columns)
 * through the REAL Better Auth handler with the admin plugin enabled:
 *
 *   sign-up → sign-in → dry-run plan writes nothing → ban (sessions + MCP
 *   OAuth tokens revoked, sign-in refused with BANNED_USER, memberships
 *   deactivated, API keys dead, audited, last OWNER kept) → ban again is a
 *   no-op → remove refused while last OWNER → unban (sign-in works, nothing
 *   restored) → remove (identity + credentials gone) → remove again is a
 *   no-op; plus the Clerk webhook path writes exactly what it wrote before,
 *   and impersonation is closed.
 */
import { randomBytes } from 'node:crypto'
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return harness.prisma
  },
}))
// Sign-up sends a verification email; nothing here should leave the process.
jest.mock('@/lib/integrations/email/client', () => ({
  sendEmail: jest.fn(async () => ({ status: 'skipped' })),
}))

import { handleAuthRequest } from '@/lib/auth/handler'
import { authUserAdminService } from '@/lib/services/auth-user-admin.service'
import { authService } from '@/lib/services/auth.service'
import { generateApiKey } from '@/lib/services/api-key.service'
import { runAuthAdmin } from '../../scripts/auth-admin/run'

jest.setTimeout(180_000)

const BASE = 'http://localhost:3000'
const WS = 'ws_ba_admin'
const SOLO_WS = 'ws_ba_solo'
const CLERK_WS = 'ws_ba_clerk'
const run = randomBytes(4).toString('hex')
const email = `lum1071-${run}@example.test`
// Throwaway password generated per run, never reused.
const password = `pw-${randomBytes(12).toString('base64url')}`

const ENV_KEYS = [
  'AUTH_PROVIDER',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'NEXT_PUBLIC_APP_URL',
] as const
const savedEnv: Record<string, string | undefined> = {}

let userId = ''

function db() {
  return harness.prisma!
}

function call(path: string, init: RequestInit = {}) {
  return handleAuthRequest(
    new Request(`${BASE}/api/auth${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        ...(init.headers ?? {}),
      },
    })
  )
}

function signIn() {
  return call('/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

/**
 * Only the session-token cookie: the 5-minute cookie cache
 * (SESSION_COOKIE_CACHE_SECONDS, RFC §4.1) is deliberately left out so the
 * check reads the database, where revocation happens.
 */
function sessionTokenCookie(res: Response): string {
  const c = res.headers
    .getSetCookie()
    .map(x => x.split(';')[0]!)
    .find(x => x.startsWith('better-auth.session_token='))
  if (!c) throw new Error('no session cookie')
  return c
}

async function sessionUserId(cookie: string): Promise<string | null> {
  const res = await call('/get-session', { headers: { cookie } })
  const body = (await res.json()) as { user?: { id: string } } | null
  return body?.user?.id ?? null
}

async function seedMember(
  id: string,
  clerkId: string,
  role: 'OWNER' | 'MEMBER',
  workspaceId: string
) {
  await db().workspaceMember.create({
    data: { id, workspaceId, clerkId, role },
  })
  await db().actor.create({
    data: { id: `actor_${id}`, workspaceId, type: 'HUMAN', memberId: id },
  })
}

async function seedKey(memberId: string): Promise<string> {
  const { key, keyHash, keyPrefix } = generateApiKey()
  await db().apiKey.create({
    data: { workspaceMemberId: memberId, label: 'laptop', keyHash, keyPrefix },
  })
  return key
}

async function seedOauthTokens(uid: string) {
  const clientId = `client_${run}`
  if (!(await db().authOauthClient.findUnique({ where: { clientId } }))) {
    await harness.insert('auth_oauth_clients', {
      id: `oc_${run}`,
      clientId,
    })
  }
  const n = await db().authOauthRefreshToken.count()
  await harness.insert('auth_oauth_refresh_tokens', {
    id: `rt_${run}_${n}`,
    token: `rt_${run}_${n}`,
    clientId,
    userId: uid,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
  })
  await harness.insert('auth_oauth_access_tokens', {
    id: `at_${run}_${n}`,
    token: `at_${run}_${n}`,
    clientId,
    userId: uid,
    expiresAt: new Date(Date.now() + 3_600_000),
    createdAt: new Date(),
  })
}

async function audits(workspaceId: string, memberId: string) {
  return db().auditEvent.findMany({
    where: { workspaceId, targetId: memberId },
    orderBy: { createdAt: 'asc' },
    select: { action: true, metadata: true, actorType: true, source: true },
  })
}

async function membership(id: string) {
  return db().workspaceMember.findUnique({
    where: { id },
    select: { deactivatedAt: true, deactivationReason: true },
  })
}

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const out = jest.spyOn(process.stdout, 'write').mockReturnValue(true)
  const err = jest.spyOn(process.stderr, 'write').mockReturnValue(true)
  try {
    return await fn()
  } finally {
    out.mockRestore()
    err.mockRestore()
  }
}

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.AUTH_PROVIDER = 'better-auth'
  process.env.BETTER_AUTH_URL = BASE
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('base64')
  delete process.env.NEXT_PUBLIC_APP_URL
  globalThis.lumoBetterAuth = undefined
  await harness.start()
  for (const id of [WS, SOLO_WS, CLERK_WS]) {
    await db().workspace.create({ data: { id, name: id, slug: id } })
  }
  await seedMember('m_ws_owner', 'user_other_owner', 'OWNER', WS)
  await seedMember('m_clerk_owner', 'user_clerk_owner', 'OWNER', CLERK_WS)
  await seedMember('m_clerk_gone', 'user_clerk_gone', 'MEMBER', CLERK_WS)
})

afterAll(async () => {
  globalThis.lumoBetterAuth = undefined
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  await harness.stop()
})

describe('LUM-1071 auth admin on Better Auth (real Postgres)', () => {
  let memberKey = ''
  let soloKey = ''
  let cookie = ''

  it('signs up a user who belongs to two workspaces (sole OWNER of one)', async () => {
    const res = await call('/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ada Lovelace', email, password }),
    })
    expect(res.status).toBe(200)
    userId = ((await res.json()) as { user: { id: string } }).user.id
    // The admin plugin's create hook gives every new user the "user" role.
    expect(
      await db().authUser.findUnique({
        where: { id: userId },
        select: { role: true, banned: true },
      })
    ).toEqual({ role: 'user', banned: false })

    await seedMember('m_ada', userId, 'MEMBER', WS)
    await seedMember('m_ada_solo', userId, 'OWNER', SOLO_WS)
    memberKey = await seedKey('m_ada')
    soloKey = await seedKey('m_ada_solo')
    await seedOauthTokens(userId)

    const signedIn = await signIn()
    expect(signedIn.status).toBe(200)
    cookie = sessionTokenCookie(signedIn)
    expect(await sessionUserId(cookie)).toBe(userId)
  })

  it('auth admin dry run prints the plan by id and writes nothing', async () => {
    const lines: string[] = []
    const spy = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        lines.push(String(chunk))
        return true
      })
    let code: number
    try {
      code = await runAuthAdmin('ban', ['--email', email.toUpperCase()])
    } finally {
      spy.mockRestore()
    }
    expect(code).toBe(0)
    const out = lines.join('')
    expect(out).toContain(`[dry-run] ban ${userId}`)
    expect(out).toContain('member m_ada (MEMBER): deactivate')
    expect(out).toContain('member m_ada_solo (OWNER): LAST OWNER')
    // Sign-up signs in too, so two sessions.
    expect(out).toContain('sessions: 2, MCP OAuth tokens: 2')
    // No personal data in the report.
    expect(out.toLowerCase()).not.toContain(email)
    expect(out).not.toContain('Ada')

    expect(await sessionUserId(cookie)).toBe(userId)
    expect(
      (await db().authUser.findUnique({ where: { id: userId } }))?.banned
    ).toBe(false)
    expect((await membership('m_ada'))?.deactivatedAt).toBeNull()
    expect(await authService.verifyApiKey(memberKey)).not.toBeNull()
    expect(await db().auditEvent.count()).toBe(0)
  })

  it('auth admin ban revokes sessions and tokens, refuses sign-in and deprovisions memberships', async () => {
    const code = await quietly(() =>
      runAuthAdmin('ban', [
        '--user-id',
        userId,
        '--reason',
        'abuse report',
        '--confirm',
      ])
    )
    expect(code).toBe(0)

    expect(
      await db().authUser.findUnique({
        where: { id: userId },
        select: { banned: true, banReason: true, banExpires: true },
      })
    ).toEqual({ banned: true, banReason: 'abuse report', banExpires: null })
    // Sessions and MCP OAuth tokens are gone; the old cookie is dead.
    expect(await db().authSession.count({ where: { userId } })).toBe(0)
    expect(await db().authOauthAccessToken.count({ where: { userId } })).toBe(0)
    expect(await db().authOauthRefreshToken.count({ where: { userId } })).toBe(
      0
    )
    expect(await sessionUserId(cookie)).toBeNull()
    // A new sign-in is refused by the admin plugin.
    const again = await signIn()
    expect(again.status).toBe(403)
    expect(((await again.json()) as { code: string }).code).toBe('BANNED_USER')
    expect(await db().authSession.count({ where: { userId } })).toBe(0)

    // Memberships: deactivated where someone else owns the workspace…
    expect(await membership('m_ada')).toMatchObject({
      deactivationReason: 'AUTH_USER_BANNED',
    })
    expect((await membership('m_ada'))?.deactivatedAt).toBeInstanceOf(Date)
    // …kept (keys revoked) where the user is the last OWNER.
    expect((await membership('m_ada_solo'))?.deactivatedAt).toBeNull()
    expect(await authService.verifyApiKey(memberKey)).toBeNull()
    expect(await authService.verifyApiKey(soloKey)).toBeNull()

    expect(await audits(WS, 'm_ada')).toEqual([
      {
        action: 'member.deprovisioned',
        actorType: 'SYSTEM',
        source: 'SYSTEM',
        metadata: {
          reason: 'AUTH_USER_BANNED',
          clerkUserId: userId,
          trigger: 'auth-admin',
          role: 'MEMBER',
          apiKeysRevoked: 1,
        },
      },
    ])
    expect(await audits(SOLO_WS, 'm_ada_solo')).toEqual([
      expect.objectContaining({
        action: 'member.api_keys_revoked',
        metadata: expect.objectContaining({
          reason: 'AUTH_USER_BANNED',
          lastOwner: true,
          apiKeysRevoked: 1,
        }),
      }),
    ])
  })

  it('auth admin ban is idempotent: a second run revokes and audits nothing', async () => {
    const before = await db().auditEvent.count()
    const result = await authUserAdminService.ban(userId, {
      reason: 'abuse report',
    })
    expect(result).toMatchObject({
      wasBanned: true,
      sessionsRevoked: 0,
      oauthTokensRevoked: 0,
    })
    expect(result.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 'm_ada',
          outcome: 'already_deactivated',
        }),
        expect.objectContaining({
          memberId: 'm_ada_solo',
          outcome: 'last_owner_kept',
          apiKeysRevoked: 0,
        }),
      ])
    )
    expect(await db().auditEvent.count()).toBe(before)
  })

  it('auth admin remove is refused while the user is the last OWNER and changes nothing', async () => {
    const before = await db().auditEvent.count()
    await expect(authUserAdminService.remove(userId)).rejects.toMatchObject({
      status: 409,
    })
    const code = await quietly(() =>
      runAuthAdmin('remove', ['--user-id', userId, '--confirm'])
    )
    expect(code).toBe(1)
    expect(await db().authUser.count({ where: { id: userId } })).toBe(1)
    expect((await membership('m_ada_solo'))?.deactivatedAt).toBeNull()
    expect(await db().auditEvent.count()).toBe(before)
  })

  it('auth admin unban lets the user sign in again but restores no membership', async () => {
    const code = await quietly(() =>
      runAuthAdmin('unban', ['--user-id', userId, '--confirm'])
    )
    expect(code).toBe(0)
    expect(
      await db().authUser.findUnique({
        where: { id: userId },
        select: { banned: true, banReason: true, banExpires: true },
      })
    ).toEqual({ banned: false, banReason: null, banExpires: null })
    const res = await signIn()
    expect(res.status).toBe(200)
    expect(await sessionUserId(sessionTokenCookie(res))).toBe(userId)
    expect((await membership('m_ada'))?.deactivatedAt).toBeInstanceOf(Date)
    expect(await authService.verifyApiKey(memberKey)).toBeNull()
    // Unbanning twice is a no-op.
    await expect(authUserAdminService.unban(userId)).resolves.toEqual({
      userId,
      changed: false,
    })
  })

  it('LUM-1344 grant-admin / revoke-admin: dry run writes nothing, --confirm flips auth_users.role', async () => {
    const role = async () =>
      (
        await db().authUser.findUnique({
          where: { id: userId },
          select: { role: true },
        })
      )?.role
    expect(
      await quietly(() => runAuthAdmin('grant-admin', ['--email', email]))
    ).toBe(0)
    expect(await role()).toBe('user')
    expect(
      await quietly(() =>
        runAuthAdmin('grant-admin', ['--user-id', userId, '--confirm'])
      )
    ).toBe(0)
    expect(await role()).toBe('admin')
    expect(
      await quietly(() =>
        runAuthAdmin('revoke-admin', ['--user-id', userId, '--confirm'])
      )
    ).toBe(0)
    expect(await role()).toBe('user')
    // Unknown user: exit 1, nothing written.
    expect(
      await quietly(() =>
        runAuthAdmin('grant-admin', ['--user-id', 'nobody', '--confirm'])
      )
    ).toBe(1)
  })

  it('auth admin remove deprovisions and deletes the identity once another OWNER exists', async () => {
    await seedMember('m_solo_owner2', 'user_second_owner', 'OWNER', SOLO_WS)
    await seedOauthTokens(userId)

    const code = await quietly(() =>
      runAuthAdmin('remove', ['--user-id', userId, '--confirm'])
    )
    expect(code).toBe(0)

    expect(await db().authUser.count({ where: { id: userId } })).toBe(0)
    expect(await db().authAccount.count({ where: { userId } })).toBe(0)
    expect(await db().authSession.count({ where: { userId } })).toBe(0)
    expect(await db().authOauthAccessToken.count({ where: { userId } })).toBe(0)
    expect(await membership('m_ada_solo')).toMatchObject({
      deactivationReason: 'AUTH_USER_DELETED',
    })
    // The earlier ban's reason is history, not overwritten.
    expect((await membership('m_ada'))?.deactivationReason).toBe(
      'AUTH_USER_BANNED'
    )
    expect((await audits(SOLO_WS, 'm_ada_solo')).map(a => a.action)).toEqual([
      'member.api_keys_revoked',
      'member.deprovisioned',
    ])
    expect((await signIn()).status).toBe(401)

    // Again: already removed, nothing written.
    const before = await db().auditEvent.count()
    await expect(authUserAdminService.remove(userId)).resolves.toEqual({
      userId,
      outcome: 'already_removed',
    })
    expect(await db().auditEvent.count()).toBe(before)
    // An id that never existed is a 404, not a silent success.
    await expect(
      authUserAdminService.remove('user_never_existed')
    ).rejects.toMatchObject({ status: 404 })
  })

  it('auth admin remove after an earlier ban (nothing left to deactivate) still reports already_removed on a re-run', async () => {
    // Its own user: MEMBER of WS only, banned first, then removed.
    const res = await call('/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Bo',
        email: `lum1071-bo-${run}@example.test`,
        password,
      }),
    })
    expect(res.status).toBe(200)
    const boId = ((await res.json()) as { user: { id: string } }).user.id
    await seedMember('m_bo', boId, 'MEMBER', WS)
    await authUserAdminService.ban(boId)
    await expect(authUserAdminService.remove(boId)).resolves.toMatchObject({
      outcome: 'removed',
      memberships: [
        expect.objectContaining({
          memberId: 'm_bo',
          outcome: 'already_deactivated',
        }),
      ],
    })
    expect((await membership('m_bo'))?.deactivationReason).toBe(
      'AUTH_USER_BANNED'
    )
    await expect(authUserAdminService.remove(boId)).resolves.toEqual({
      userId: boId,
      outcome: 'already_removed',
    })
  })

  it('auth admin remove of an id that was never a Better Auth user is not found, even with deactivated memberships', async () => {
    await seedMember('m_left', 'user_only_left', 'MEMBER', WS)
    await db().workspaceMember.update({
      where: { id: 'm_left' },
      data: { deactivatedAt: new Date(), deactivationReason: 'LEFT' },
    })
    const before = await db().auditEvent.count()
    await expect(
      authUserAdminService.remove('user_only_left')
    ).rejects.toMatchObject({
      status: 404,
      message: 'No Better Auth user with id user_only_left',
    })
    const errors: string[] = []
    const err = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        errors.push(String(chunk))
        return true
      })
    const out = jest.spyOn(process.stdout, 'write').mockReturnValue(true)
    let codes: number[]
    try {
      codes = [
        await runAuthAdmin('remove', [
          '--user-id',
          'user_only_left',
          '--confirm',
        ]),
        await runAuthAdmin('remove', [
          '--email',
          `nobody-${run}@example.test`,
          '--confirm',
        ]),
      ]
    } finally {
      err.mockRestore()
      out.mockRestore()
    }
    expect(codes).toEqual([1, 1])
    expect(errors.join('')).toContain(
      'No Better Auth user with id user_only_left'
    )
    expect(errors.join('')).toContain('No Better Auth user with that email')
    expect(errors.join('')).not.toContain('already removed')
    // Nothing written.
    expect(await membership('m_left')).toMatchObject({
      deactivationReason: 'LEFT',
    })
    expect(await db().auditEvent.count()).toBe(before)
  })

  it('auth admin: impersonation endpoints are closed (404)', async () => {
    for (const path of [
      '/admin/impersonate-user',
      '/admin/stop-impersonating',
    ]) {
      const res = await call(path, {
        method: 'POST',
        body: JSON.stringify({ userId: 'user_other_owner' }),
      })
      expect([path, res.status]).toEqual([path, 404])
    }
  })
})
