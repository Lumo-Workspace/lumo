/**
 * @jest-environment node
 *
 * LUM-1072 — the whole Clerk → Better Auth migration through the REAL script
 * entry (runAuthMigration) against a REAL Postgres (every migration replayed
 * into PGlite) and the REAL Better Auth handler (T1 bcrypt verify, T2 ban):
 *
 *   seal CSV → export (fake Clerk API, 429 on the way) → import dry run
 *   (writes nothing) → import → import again (no-op) → sign-in checks →
 *   gap activity → closing export + import --closing → verify → avatars →
 *   rekey (window users, dry run, apply, collision refused)
 *
 * and every line printed is checked for personal data.
 */
import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hashSync } from 'bcryptjs'
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'
import { withSoftDelete } from '@/lib/db/soft-delete'
import {
  FIXTURE_IDS as ID,
  fakeClerkApi,
  loadClerkFixture,
} from '@/test-utils/auth-migration-fixtures'
import type { ClerkApiUser } from '@/lib/auth-migration/clerk-export'
import type { BlobStorage } from '@/lib/blob/types'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)
let extended: ReturnType<typeof withSoftDelete> | null = null

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    if (!extended && harness.prisma) extended = withSoftDelete(harness.prisma)
    return extended
  },
}))
jest.mock('@/lib/integrations/email/client', () => ({
  sendEmail: jest.fn(async () => ({ status: 'skipped' })),
}))

import { handleAuthRequest } from '@/lib/auth/handler'
import { getBetterAuth } from '@/lib/auth/better-auth/server'
import { seal } from '@/lib/auth-migration/sealed-file'
import {
  runAuthMigration,
  type MigrationDeps,
} from '../../scripts/auth-migration/run'
import type { MigrationCommand } from '../../scripts/auth-migration/cli'

jest.setTimeout(240_000)

const BASE = 'http://localhost:3000'
const PASS = `pass-${randomBytes(16).toString('hex')}`
const CLERK_KEY = `sk_test_${randomBytes(12).toString('hex')}`
const GAP_USER = 'user_2gapUser0012'
const GAP_CONFLICT = 'user_2gapConf0013'
const NEW_CLERK_ID = 'user_2newClerk0099'
const ENV_KEYS = [
  'AUTH_PROVIDER',
  'BETTER_AUTH_URL',
  'BETTER_AUTH_SECRET',
  'NEXT_PUBLIC_APP_URL',
] as const
const savedEnv: Record<string, string | undefined> = {}

const fx = loadClerkFixture()
const dir = mkdtempSync(path.join(tmpdir(), 'lum1072-e2e-'))
const f = (name: string) => path.join(dir, name)
const printed: string[] = []
const blobs = new Map<string, Buffer>()

function db() {
  return harness.prisma!
}

const storage: BlobStorage = {
  kind: 'disk',
  put: async (pathname: string, body: unknown) => {
    const name = pathname.replace(
      /\.(\w+)$/,
      `-${randomBytes(3).toString('hex')}.$1`
    )
    blobs.set(name, Buffer.from(body as Buffer))
    return { url: `https://blob.example.test/${name}`, pathname: name }
  },
} as unknown as BlobStorage

let avatarStatus: Record<string, number> = {}
let clerkUsers: ClerkApiUser[] = fx.apiUsers

function deps(): MigrationDeps {
  const api = fakeClerkApi(clerkUsers, { rateLimitOn: [2], retryAfter: '0' })
  return {
    env: {
      LUMO_MIGRATION_PASSPHRASE: PASS,
      CLERK_MIGRATION_SECRET_KEY: CLERK_KEY,
      DATABASE_URL: harness.connectionString!,
    },
    write: l => printed.push(l),
    writeError: l => printed.push(l),
    now: () => new Date(),
    clerkFetch: api.fetchImpl,
    sleep: async () => {},
    avatarFetch: async url => {
      const status = avatarStatus[url] ?? 200
      return {
        ok: status === 200,
        status,
        headers: {
          get: (n: string) => (n === 'content-type' ? 'image/png' : null),
        },
        arrayBuffer: async () =>
          new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer,
      }
    },
    getStorage: async () => storage,
  }
}

async function run(command: MigrationCommand, ...argv: string[]) {
  const start = printed.length
  const code = await runAuthMigration(command, argv, deps())
  return { code, out: printed.slice(start).join('\n') }
}

function call(p: string, init: RequestInit = {}) {
  return handleAuthRequest(
    new Request(`${BASE}/api/auth${p}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        origin: BASE,
        ...(init.headers ?? {}),
      },
    })
  )
}
const signIn = (email: string, password: string) =>
  call('/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

function sealPlain(name: string, text: string) {
  writeFileSync(f(name), seal(Buffer.from(text, 'utf8'), PASS), { mode: 0o600 })
}

async function seedBusinessData() {
  await harness.insert('workspaces', {
    id: 'ws1',
    name: 'W',
    slug: 'w1',
    deletionRequestedByClerkId: ID.pwOnly,
  })
  const member = (id: string, clerkId: string, deactivated = false) =>
    harness.insert('workspace_members', {
      id,
      workspaceId: 'ws1',
      clerkId,
      ...(deactivated
        ? {
            deactivatedAt: new Date(),
            deactivationReason: 'CLERK_USER_DELETED',
          }
        : {}),
    })
  await member('m_ada', ID.pwOnly)
  await member('m_mary', ID.pwAndGh)
  await member('m_grace', ID.ghOnly)
  await member('m_banned', ID.banned, true)
  // Deleted from Clerk long ago: history keeps the id, no active membership.
  await member('m_gone', 'user_2deletedLongAgo', true)
  await harness.insert('teams', {
    id: 'team1',
    workspaceId: 'ws1',
    name: 'T',
    identifier: 'LUM',
  })
  await harness.insert('projects', {
    id: 'p1',
    workspaceId: 'ws1',
    teamId: 'team1',
    createdByMemberId: 'm_ada',
    name: 'P',
  })
  await harness.insert('tasks', {
    id: 't1',
    projectId: 'p1',
    teamId: 'team1',
    number: 1,
    title: 'T',
    deletedAt: new Date(),
    deletedByClerkId: ID.pwAndGh,
    description: `<p><span class="mention" data-mention-type="user" data-id="${ID.ghOnly}">@G</span></p>`,
  })
  await harness.insert('tasks', {
    id: 't2',
    projectId: 'p1',
    teamId: 'team1',
    number: 2,
    title: 'T2',
  })
  await harness.insert('comments', {
    id: 'c1',
    taskId: 't2',
    body: `<p><span class="mention" data-mention-type="user" data-id="${ID.pwOnly}">@A</span></p>`,
  })
  await harness.insert('Document', {
    id: 'd1',
    workspaceId: 'ws1',
    createdById: 'm_ada',
    slug: 'd1',
    deletedAt: new Date(),
    deletedByClerkId: ID.pwOnly,
  })
  await harness.insert('McpConnection', {
    id: 'mc1',
    clerkUserId: ID.ghOnly,
    clientId: 'client1',
  })
  await harness.insert('McpAuditLog', {
    id: 'ml1',
    connectionId: 'mc1',
    clerkUserId: ID.ghOnly,
    toolName: 'x',
    status: 'ok',
  })
  await harness.insert('audit_events', {
    id: 'ae1',
    workspaceId: 'ws1',
    actorType: 'MEMBER',
    actorId: ID.pwOnly,
  })
  await harness.insert('audit_events', {
    id: 'ae2',
    workspaceId: 'ws1',
    actorType: 'SYSTEM',
    actorId: 'system-cron',
  })
  await harness.insert('subprocessor_notice_deliveries', {
    id: 's1',
    changeId: 'ch1',
    workspaceId: 'ws1',
    clerkId: ID.pwAndGh,
  })
  await harness.insert('workspace_deletion_receipts', {
    id: 'r1',
    workspaceId: 'ws1',
    requestedByClerkId: ID.pwOnly,
  })
  await harness.insert('workspace_exports', {
    id: 'x1',
    workspaceId: 'ws1',
    requestedByClerkId: ID.pwOnly,
    lastDownloadedByClerkId: ID.pwAndGh,
  })
  await harness.insert('priority_overrides', {
    id: 'po1',
    taskId: 't2',
    projectId: 'p1',
    memberId: ID.pwAndGh,
    aiSuggested: 'HIGH',
    userChosen: 'LOW',
    taskTitle: 'T2',
  })
  await harness.insert('workspace_invites', {
    id: 'inv1',
    workspaceId: 'ws1',
    invitedById: 'm_ada',
    email: 'mary.work@example.com',
    status: 'PENDING',
    expiresAt: new Date(Date.now() + 86_400_000),
  })
}

beforeAll(async () => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k]
  process.env.AUTH_PROVIDER = 'better-auth'
  process.env.BETTER_AUTH_URL = BASE
  process.env.BETTER_AUTH_SECRET = randomBytes(32).toString('base64')
  delete process.env.NEXT_PUBLIC_APP_URL
  globalThis.lumoBetterAuth = undefined
  await harness.start()
  await seedBusinessData()
})

afterAll(async () => {
  globalThis.lumoBetterAuth = undefined
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  await harness.stop()
})

describe('LUM-1072 migration pipeline (real Postgres + real Better Auth)', () => {
  let tImport = ''
  let gapBaUserId = ''

  it('seal + export: fake Clerk API (429 retried) joined with the sealed CSV', async () => {
    writeFileSync(f('users.csv'), fx.csvText)
    expect(
      (await run('seal', '--in', f('users.csv'), '--out', f('users.csv.enc')))
        .code
    ).toBe(0)
    const r = await run(
      'export',
      '--out',
      f('export1.enc'),
      '--csv',
      f('users.csv.enc')
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain('Clerk instance: test')
    expect(r.out).toContain('Clerk count: 11; fetched: 11')
    // Plaintext and repo paths are refused.
    expect((await run('import', '--in', f('users.csv'))).out).toMatch(
      /Not a sealed file/
    )
    expect(
      (await run('export', '--out', path.join(process.cwd(), 'x.enc'))).out
    ).toMatch(/inside a git repository/)
  })

  it('import dry run prints counts only and writes nothing', async () => {
    const r = await run('import', '--in', f('export1.enc'))
    expect(r.code).toBe(0)
    expect(r.out).toContain(
      'plan: create=8, update=0, unchanged=0, keep=0, skip=3'
    )
    expect(r.out).toContain(
      'skipped: email_case_conflict=2, email_taken=0, no_email=1'
    )
    expect(r.out).toContain('pending invites to a non-primary email: 1')
    expect(r.out).toContain(
      'password hashers: (no password)=5, argon2id=1, bcrypt=5'
    )
    expect(r.out).toContain('[dry-run]')
    expect(await db().authUser.count()).toBe(0)
  })

  it('import writes users, credential and social accounts and ban state; a re-run changes nothing', async () => {
    const r = await run(
      'import',
      '--in',
      f('export1.enc'),
      '--confirm',
      '--details-out',
      f('details1.enc')
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain('applied: 8; failed: 0')
    tImport = /T_import \(pass to --closing --since\): (\S+)/.exec(r.out)![1]!
    expect(await db().authUser.count()).toBe(8)
    expect(
      await db().authUser.findUnique({
        where: { id: ID.banned },
        select: { banned: true, role: true },
      })
    ).toEqual({ banned: true, role: 'user' })
    expect(
      await db().authAccount.count({ where: { providerId: 'credential' } })
    ).toBe(5)
    const again = await run('import', '--in', f('export1.enc'), '--confirm')
    expect(again.out).toContain(
      'plan: create=0, update=0, unchanged=8, keep=0, skip=3'
    )
    expect(again.out).toContain('applied: 0; failed: 0')
  })

  it('imported users sign in through Better Auth: bcrypt password, ban refused, social key linked', async () => {
    expect(
      (await signIn('ada@example.com', fx.passwords[ID.pwOnly]!)).status
    ).toBe(200)
    expect((await signIn('ADA@example.com', 'wrong-password-123')).status).toBe(
      401
    )
    expect(
      (await signIn('kat@example.com', fx.passwords[ID.unverified]!)).status
    ).toBe(200)
    const banned = await signIn('banned@example.com', fx.passwords[ID.banned]!)
    expect(banned.status).toBe(403)
    expect(((await banned.json()) as { code?: string }).code).toBe(
      'BANNED_USER'
    )
    const ctx = await getBetterAuth().$context
    for (const [providerId, accountId, owner] of [
      ['github', '1000002', ID.ghOnly],
      ['google', '109000000000000000003', ID.goOnly],
      ['github', '1000004', ID.pwAndGh],
    ] as const) {
      const found = await ctx.internalAdapter.findAccountOwnerByKey({
        providerId,
        accountId,
      })
      expect(found).toMatchObject({ kind: 'owned', user: { id: owner } })
    }
  })

  it('closing import: inserts gap users, keeps a password changed in Better Auth, reports the email conflict', async () => {
    // After T_import, in Better Auth: Ada changes her password; someone signs up.
    const adaSession = await signIn('ada@example.com', fx.passwords[ID.pwOnly]!)
    const cookie = adaSession.headers
      .getSetCookie()
      .map(c => c.split(';')[0])
      .join('; ')
    const adaNew = `pw-${randomBytes(9).toString('base64url')}`
    const changed = await call('/change-password', {
      method: 'POST',
      headers: { cookie },
      body: JSON.stringify({
        currentPassword: fx.passwords[ID.pwOnly],
        newPassword: adaNew,
      }),
    })
    expect(changed.status).toBe(200)
    const baPw = `pw-${randomBytes(9).toString('base64url')}`
    const signUp = await call('/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Gap Conflict',
        email: 'gapconf@example.com',
        password: baPw,
      }),
    })
    expect(signUp.status).toBe(200)
    gapBaUserId = ((await signUp.json()) as { user: { id: string } }).user.id
    expect(gapBaUserId).toMatch(/^user_/)

    // Meanwhile in Clerk (before promote froze it): Mary changed her password,
    // two people signed up — one with the email used above.
    const maryNew = `pw-${randomBytes(9).toString('base64url')}`
    const gapPw = `pw-${randomBytes(9).toString('base64url')}`
    const maryHash = hashSync(maryNew, 4).replace(/^\$2b\$/, '$2a$')
    const csv2 =
      fx.csvText
        .split('\n')
        .map(l =>
          l.startsWith(`${ID.pwAndGh},`)
            ? l.replace(/\$2a\$04\$[^,]+/, maryHash)
            : l
        )
        .join('\n') +
      `${GAP_USER},Gap,User,,gap@example.com,,gap@example.com,,,,,${hashSync(gapPw, 4)},bcrypt\n` +
      `${GAP_CONFLICT},Gap,Conf,,gapconf@example.com,,gapconf@example.com,,,,,,\n`
    sealPlain('users2.csv.enc', csv2)
    const mk = (id: string, email: string, n: number): ClerkApiUser => ({
      id,
      first_name: 'Gap',
      last_name: 'User',
      has_image: false,
      created_at: 1760000100000 + n,
      primary_email_address_id: `idn_${id}`,
      email_addresses: [
        {
          id: `idn_${id}`,
          email_address: email,
          verification: { status: 'verified' },
        },
      ],
      external_accounts: [],
      banned: false,
      locked: false,
      password_enabled: true,
    })
    clerkUsers = [
      ...fx.apiUsers,
      mk(GAP_USER, 'gap@example.com', 1),
      mk(GAP_CONFLICT, 'gapconf@example.com', 2),
    ]
    expect(
      (
        await run(
          'export',
          '--out',
          f('export2.enc'),
          '--csv',
          f('users2.csv.enc')
        )
      ).code
    ).toBe(0)

    expect(
      (await run('import', '--in', f('export2.enc'), '--closing')).code
    ).toBe(1) // --since required
    const r = await run(
      'import',
      '--in',
      f('export2.enc'),
      '--closing',
      '--since',
      tImport,
      '--confirm'
    )
    expect(r.code).toBe(0)
    expect(r.out).toContain('mode: closing')
    expect(r.out).toContain(
      'plan: create=1, update=0, unchanged=0, keep=8, skip=4'
    )
    expect(r.out).toContain('email_taken=1')
    expect(r.out).toContain(
      'credential changed in Better Auth after T_import (kept): 1'
    )

    expect((await signIn('gap@example.com', gapPw)).status).toBe(200)
    expect((await signIn('mary@example.com', maryNew)).status).toBe(200)
    expect((await signIn('ada@example.com', adaNew)).status).toBe(200)
    expect(
      (await signIn('ada@example.com', fx.passwords[ID.pwOnly]!)).status
    ).toBe(401)
    expect((await signIn('gapconf@example.com', baPw)).status).toBe(200)
  })

  it('verify: Clerk total = imported + skipped and every id in the 12 columns and mentions exists in auth_users', async () => {
    const r = await run('verify', '--in', f('export2.enc'))
    expect(r.out).toContain(
      'Clerk total: 13; exported: 13; imported: 9; skipped: 4'
    )
    expect(r.out).toContain(
      'unexplained missing: 0; expected accounts missing: 0'
    )
    // The long-deleted user is reported but has no active membership.
    expect(r.out).toMatch(
      /WorkspaceMember\.clerkId: 5 \/ 1 \/ 0 \(prefixes: user_=1\)/
    )
    expect(r.out).toContain('Task.deletedByClerkId: 1 / 0 / 0')
    expect(r.out).toContain('Document.deletedByClerkId: 1 / 0 / 0')
    expect(r.out).toContain('AuditEvent.actorId: 1 / 0 / 0')
    expect(r.out).toContain('PriorityOverride.memberId: 1 / 0 / 0')
    expect(r.out).toContain('Comment.body: 1 / 0 / 0')
    expect(r.out).toContain('Task.description: 1 / 0 / 0')
    expect(r.out).toContain('OK')
    expect(r.code).toBe(0)

    // An active member whose id is not in auth_users fails verify.
    await harness.insert('workspace_members', {
      id: 'm_orphan',
      workspaceId: 'ws1',
      clerkId: 'user_2notImported',
    })
    const bad = await run('verify', '--in', f('export2.enc'))
    expect(bad.code).toBe(1)
    expect(bad.out).toContain(
      'PROBLEM: 1 id(s) with an active membership not found in auth_users'
    )
    await db().workspaceMember.delete({ where: { id: 'm_orphan' } })
  })

  it('avatars: dry run counts, copy failures are reported, a re-run finishes the rest', async () => {
    const dry = await run('avatars')
    expect(dry.out).toContain('avatars still on Clerk hosts: 2')
    avatarStatus = { 'https://img.clerk.com/fake-avatar-2': 404 }
    const first = await run('avatars', '--confirm')
    expect(first.code).toBe(1)
    expect(first.out).toContain('transferred: 1; failed: 1 (http_404=1)')
    avatarStatus = {}
    const second = await run('avatars', '--confirm')
    expect(second.code).toBe(0)
    expect(second.out).toContain('transferred: 1; failed: 0')
    const ada = await db().authUser.findUnique({
      where: { id: ID.pwOnly },
      select: { image: true },
    })
    expect(ada!.image).toMatch(
      new RegExp(
        `^https://blob\\.example\\.test/avatars/${ID.pwOnly}/avatar-\\w+\\.png$`
      )
    )
    expect(blobs.size).toBe(2)
    expect((await run('avatars')).out).toContain(
      'avatars still on Clerk hosts: 0'
    )
  })

  it('rekey: lists window users, dry-runs, rewrites every column and mention, refuses collisions', async () => {
    // The Better Auth-only user joined the workspace during the window.
    await harness.insert('workspace_members', {
      id: 'm_gap',
      workspaceId: 'ws1',
      clerkId: gapBaUserId,
    })
    await harness.insert('comments', {
      id: 'c2',
      taskId: 't2',
      body: `<p><span class="mention" data-mention-type="user" data-id="${gapBaUserId}">@G</span> <span class="mention" data-mention-type="user" data-id="${ID.pwOnly}">@A</span></p>`,
    })
    await harness.insert('priority_overrides', {
      id: 'po2',
      taskId: 't2',
      projectId: 'p1',
      memberId: gapBaUserId,
      aiSuggested: 'HIGH',
      userChosen: 'LOW',
      taskTitle: 'T2',
    })
    await harness.insert('McpConnection', {
      id: 'mc2',
      clerkUserId: gapBaUserId,
      clientId: 'client2',
    })

    const w = await run(
      'rekey',
      '--window-since',
      tImport,
      '--window-out',
      f('window.enc')
    )
    expect(w.out).toContain('created after the window start: 1')

    sealPlain('map.enc', JSON.stringify({ [gapBaUserId]: NEW_CLERK_ID }))
    const dry = await run('rekey', '--map', f('map.enc'))
    expect(dry.code).toBe(0)
    expect(dry.out).toContain('WorkspaceMember.clerkId=1')
    expect(dry.out).toContain('Comment.body=1')
    expect(dry.out).toContain('rows already referencing a new id: 0')
    expect(
      await db().workspaceMember.count({ where: { clerkId: gapBaUserId } })
    ).toBe(1)

    const r = await run('rekey', '--map', f('map.enc'), '--confirm')
    expect(r.code).toBe(0)
    expect(r.out).toContain('rewritten rows:')
    expect(
      await db().workspaceMember.findUnique({
        where: { id: 'm_gap' },
        select: { clerkId: true },
      })
    ).toEqual({ clerkId: NEW_CLERK_ID })
    expect(
      (await db().priorityOverride.findUnique({ where: { id: 'po2' } }))!
        .memberId
    ).toBe(NEW_CLERK_ID)
    expect(
      (await db().mcpConnection.findUnique({ where: { id: 'mc2' } }))!
        .clerkUserId
    ).toBe(NEW_CLERK_ID)
    const body = (await db().comment.findUnique({ where: { id: 'c2' } }))!.body
    expect(body).toContain(`data-id="${NEW_CLERK_ID}"`)
    expect(body).toContain(`data-id="${ID.pwOnly}"`)
    expect(body).not.toContain(gapBaUserId)

    // Mapping onto an id that is already referenced would merge two people.
    sealPlain('map-bad.enc', JSON.stringify({ [ID.goOnly]: ID.pwOnly }))
    const bad = await run('rekey', '--map', f('map-bad.enc'), '--confirm')
    expect(bad.code).toBe(1)
    expect(bad.out).toMatch(/already reference a new id; refusing/)
  })

  it('nothing printed contains personal data, hashes, secrets or full user ids', () => {
    const all = printed.join('\n')
    expect(all).not.toMatch(/@example\.com|example\.com/i)
    expect(all).not.toMatch(/\$2[aby]\$|\$argon2/)
    for (const name of [
      'Ada',
      'Lovelace',
      'Grace',
      'Hopper',
      'Mary',
      'Kat',
      'Turing',
      'phoneuser',
    ]) {
      expect(all).not.toContain(name)
    }
    expect(all).not.toContain(PASS)
    expect(all).not.toContain(CLERK_KEY)
    for (const id of [
      ...Object.values(ID),
      GAP_USER,
      GAP_CONFLICT,
      gapBaUserId,
      NEW_CLERK_ID,
    ]) {
      expect(all).not.toContain(id)
    }
  })
})
