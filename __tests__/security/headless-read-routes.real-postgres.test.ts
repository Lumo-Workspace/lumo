/**
 * @jest-environment node
 *
 * LUM-1192 — the inbox / drafts / project stats read routes accept
 * an API key, and stay scoped to the credential's workspace.
 *
 *   GET /api/notifications             (lumo inbox list)
 *   GET /api/drafts                    (lumo draft list)
 *   GET /api/stats/project/[id]        (lumo project overview)
 *   GET /api/summaries/project/[id]    (lumo project overview)
 *
 * Two workspaces, ALPHA and BRAVO. The REAL handlers, services and
 * repositories run against a REAL Postgres (every migration replayed into
 * PGlite); only Clerk and outbound side effects are stubbed, and the Bearer
 * path is real (the token's sha256 is looked up in `api_keys`). Every BRAVO
 * string carries BRAVO_MARK; it must never reach an ALPHA-scoped caller.
 * Fixture tokens are plain readable strings, not secret-shaped.
 */
import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'
import { withSoftDelete } from '@/lib/db/soft-delete'

const { PrismaClient } =
  jest.requireActual<typeof import('@prisma/client')>('@prisma/client')
const harness = createPgliteHarness(PrismaClient)
const holder: { client: import('@prisma/client').PrismaClient | null } = {
  client: null,
}

jest.mock('@/lib/db/prisma', () => ({
  get prisma() {
    return holder.client
  },
}))

const clerkSession: { userId: string | null } = { userId: null }
jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(async () => ({ userId: clerkSession.userId })),
  currentUser: jest.fn(async () => null),
  clerkClient: jest.fn(async () => ({
    users: {
      getUserList: jest.fn(async () => ({ data: [], totalCount: 0 })),
      getUser: jest.fn(async () => {
        throw Object.assign(new Error('clerk stub: no user'), { status: 404 })
      }),
    },
  })),
}))
jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }))
jest.mock('@/lib/runtime/wait-until', () => ({
  waitUntil: (p: unknown) => {
    void Promise.resolve(p).catch(() => {})
  },
}))
const inflight: { headers: Headers } = { headers: new Headers() }
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => inflight.headers),
}))

import * as notificationsRoute from '@/app/api/notifications/route'
import * as draftsRoute from '@/app/api/drafts/route'
import * as projectStatsRoute from '@/app/api/stats/project/[projectId]/route'
import * as projectSummariesRoute from '@/app/api/summaries/project/[projectId]/route'

import { formatInbox } from '@/cli/src/commands/inbox-list'
import { formatDraftList } from '@/cli/src/commands/draft-list'
import { formatProjectOverview } from '@/cli/src/lib/overview-format'

jest.setTimeout(240_000)

const BRAVO_MARK = 'bravo-private'
const DUAL_CLERK = 'user_lum1192_dual'
const CLERK = {
  alphaOwner: 'user_lum1192_alpha_owner',
  alphaMember: 'user_lum1192_alpha_member',
  bravoOwner: 'user_lum1192_bravo_owner',
  dualAlpha: DUAL_CLERK,
}
const TOKEN = {
  alphaOwner: 'lum1192-fixture-bearer-alpha-owner',
  alphaMember: 'lum1192-fixture-bearer-alpha-member',
  bravoOwner: 'lum1192-fixture-bearer-bravo-owner',
  /** The dual member's key bound to ALPHA. */
  dualAlpha: 'lum1192-fixture-bearer-dual-alpha',
}
type Caller = keyof typeof CLERK
const SLUG = { alpha: 'lum1192-alpha', bravo: 'lum1192-bravo' }

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

interface Ws {
  workspaceId: string
  teamId: string
  projectId: string
  taskId: string
  ownerActorId: string
}
const fx: { alpha: Ws | null; bravo: Ws | null } = { alpha: null, bravo: null }
const A = () => fx.alpha!
const B = () => fx.bravo!

async function addMember(
  ws: Pick<Ws, 'workspaceId' | 'teamId'>,
  clerkId: string,
  token: string,
  role: 'OWNER' | 'MEMBER'
) {
  const db = harness.prisma!
  const member = await db.workspaceMember.create({
    data: { workspaceId: ws.workspaceId, clerkId, role },
  })
  const actor = await db.actor.create({
    data: { workspaceId: ws.workspaceId, type: 'HUMAN', memberId: member.id },
  })
  await db.teamMember.create({
    data: { teamId: ws.teamId, memberId: member.id },
  })
  await db.apiKey.create({
    data: {
      workspaceMemberId: member.id,
      label: `${clerkId} key`,
      keyHash: sha256(token),
      keyPrefix: token.slice(0, 16),
    },
  })
  return { memberId: member.id, actorId: actor.id }
}

async function seedPersonal(
  ws: Ws,
  actorId: string,
  mark: string
): Promise<void> {
  const db = harness.prisma!
  await db.notification.create({
    data: {
      workspaceId: ws.workspaceId,
      recipientActorId: actorId,
      type: 'TASK_ASSIGNED',
      taskId: ws.taskId,
    },
  })
  await db.draft.create({
    data: {
      workspaceId: ws.workspaceId,
      creatorId: actorId,
      type: 'TASK',
      data: { title: `${mark} draft` },
    },
  })
}

async function seedWorkspace(
  label: 'alpha' | 'bravo',
  ownerClerkId: string,
  ownerToken: string
): Promise<Ws> {
  const db = harness.prisma!
  const mark = label === 'bravo' ? BRAVO_MARK : 'alpha-own'
  const workspace = await db.workspace.create({
    data: { name: `${mark} workspace`, slug: SLUG[label] },
  })
  const team = await db.team.create({
    data: {
      workspaceId: workspace.id,
      name: `${mark} team`,
      identifier: 'HDL',
      isDefault: true,
    },
  })
  const owner = await addMember(
    { workspaceId: workspace.id, teamId: team.id },
    ownerClerkId,
    ownerToken,
    'OWNER'
  )
  const project = await db.project.create({
    data: {
      workspaceId: workspace.id,
      teamId: team.id,
      createdByMemberId: owner.memberId,
      name: `${mark} project`,
    },
  })
  const task = await db.task.create({
    data: {
      projectId: project.id,
      workspaceId: workspace.id,
      teamId: team.id,
      number: 1,
      title: `${mark} task one`,
      status: 'DONE',
    },
  })
  await db.projectSummary.create({
    data: {
      projectId: project.id,
      stats: {},
      tldr: `${mark} project tldr`,
      report: `${mark} project report`,
    },
  })
  return {
    workspaceId: workspace.id,
    teamId: team.id,
    projectId: project.id,
    taskId: task.id,
    ownerActorId: owner.actorId,
  }
}

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  fx.alpha = await seedWorkspace('alpha', CLERK.alphaOwner, TOKEN.alphaOwner)
  fx.bravo = await seedWorkspace('bravo', CLERK.bravoOwner, TOKEN.bravoOwner)
  const alphaMember = await addMember(
    A(),
    CLERK.alphaMember,
    TOKEN.alphaMember,
    'MEMBER'
  )
  await seedPersonal(A(), A().ownerActorId, 'alpha-owner')
  await seedPersonal(A(), alphaMember.actorId, 'alpha-member-only')
  await seedPersonal(B(), B().ownerActorId, BRAVO_MARK)
  // The dual member: one human in both workspaces; only the ALPHA-bound key
  // is a credential. BRAVO holds their personal rows too, so a scope that
  // followed the human (not the key) would leak them.
  const dualAlpha = await addMember(A(), DUAL_CLERK, TOKEN.dualAlpha, 'MEMBER')
  await seedPersonal(A(), dualAlpha.actorId, 'dual-alpha')
  const db = harness.prisma!
  const dualBravoMember = await db.workspaceMember.create({
    data: { workspaceId: B().workspaceId, clerkId: DUAL_CLERK, role: 'MEMBER' },
  })
  const dualBravoActor = await db.actor.create({
    data: {
      workspaceId: B().workspaceId,
      type: 'HUMAN',
      memberId: dualBravoMember.id,
    },
  })
  await db.teamMember.create({
    data: { teamId: B().teamId, memberId: dualBravoMember.id },
  })
  await seedPersonal(B(), dualBravoActor.id, `${BRAVO_MARK} dual`)
})

afterAll(async () => {
  await harness.stop()
})

type Source = 'clerk' | 'bearer'
interface As {
  caller: Caller
  source: Source
  activeSlug?: string
}

async function call(
  handler: unknown,
  method: string,
  path: string,
  params: Record<string, string>,
  as: As
): Promise<{ status: number; text: string; json: () => unknown }> {
  clerkSession.userId = as.source === 'clerk' ? CLERK[as.caller] : null
  const headers: Record<string, string> = {}
  if (as.source === 'bearer')
    headers.authorization = `Bearer ${TOKEN[as.caller]}`
  if (as.activeSlug) headers['x-lumo-workspace'] = as.activeSlug
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    headers,
  })
  inflight.headers = request.headers
  const res = await (
    handler as (
      r: NextRequest,
      c: { params: Promise<Record<string, string>> }
    ) => Promise<Response>
  )(request, { params: Promise.resolve(params) })
  const text = await res.text()
  return { status: res.status, text, json: () => JSON.parse(text) }
}

const get = {
  notifications: (as: As) =>
    call(notificationsRoute.GET, 'GET', '/api/notifications', {}, as),
  drafts: (as: As, query = '') =>
    call(draftsRoute.GET, 'GET', `/api/drafts${query}`, {}, as),
  projectStats: (as: As, projectId: string) =>
    call(
      projectStatsRoute.GET,
      'GET',
      `/api/stats/project/${projectId}`,
      { projectId },
      as
    ),
  projectSummaries: (as: As, projectId: string) =>
    call(
      projectSummariesRoute.GET,
      'GET',
      `/api/summaries/project/${projectId}?limit=1`,
      { projectId },
      as
    ),
}

const alphaKey: As = { caller: 'alphaOwner', source: 'bearer' }
const bravoKey: As = { caller: 'bravoOwner', source: 'bearer' }

describe('LUM-1192 API key reads (200, own workspace data)', () => {
  it('GET /api/notifications: the caller’s own inbox', async () => {
    const res = await get.notifications(alphaKey)
    expect(res.status).toBe(200)
    const body = res.json() as {
      notifications: Array<{ type: string; task: { title: string } | null }>
      unreadCount: number
    }
    expect(body.notifications).toHaveLength(1)
    expect(body.notifications[0]!.type).toBe('TASK_ASSIGNED')
    expect(body.notifications[0]!.task?.title).toBe('alpha-own task one')
    expect(body.unreadCount).toBe(1)
    expect(res.text).not.toContain(BRAVO_MARK)
  })

  it('GET /api/drafts: only the caller’s own drafts (never another member’s)', async () => {
    const owner = await get.drafts(alphaKey)
    expect(owner.status).toBe(200)
    expect(owner.text).toContain('alpha-owner draft')
    expect(owner.text).not.toContain('alpha-member-only draft')
    expect(owner.text).not.toContain('dual-alpha draft')
    expect(owner.text).not.toContain(BRAVO_MARK)
    const member = await get.drafts({ caller: 'alphaMember', source: 'bearer' })
    expect(member.status).toBe(200)
    expect(member.text).toContain('alpha-member-only draft')
    expect(member.text).not.toContain('alpha-owner draft')
  })

  it('GET /api/drafts?workspaceUrl=<own slug> is 200', async () => {
    const res = await get.drafts(alphaKey, `?workspaceUrl=${SLUG.alpha}`)
    expect(res.status).toBe(200)
    expect(res.text).toContain('alpha-owner draft')
  })

  it('GET /api/stats/project/[own]: 200', async () => {
    const res = await get.projectStats(alphaKey, A().projectId)
    expect(res.status).toBe(200)
    expect(
      (res.json() as { stats: { totalTasks: number } }).stats.totalTasks
    ).toBe(1)
  })

  it('GET /api/summaries/project/[own]: 200 with the stored summary', async () => {
    const res = await get.projectSummaries(alphaKey, A().projectId)
    expect(res.status).toBe(200)
    expect(res.text).toContain('alpha-own project tldr')
  })

  it('control: BRAVO’s own key reads BRAVO’s data on every route', async () => {
    expect((await get.notifications(bravoKey)).text).toContain(
      `${BRAVO_MARK} task one`
    )
    expect((await get.drafts(bravoKey)).text).toContain(`${BRAVO_MARK} draft`)
    expect((await get.projectStats(bravoKey, B().projectId)).status).toBe(200)
    expect(
      (await get.projectSummaries(bravoKey, B().projectId)).text
    ).toContain(`${BRAVO_MARK} project tldr`)
  })

  it('summary GETs only read: no summary row is created', async () => {
    const db = harness.prisma!
    const before = await db.projectSummary.count()
    await get.projectSummaries(alphaKey, A().projectId)
    expect(await db.projectSummary.count()).toEqual(before)
  })
})

describe('LUM-1192 cross-tenant: an ALPHA key never reaches BRAVO', () => {
  it.each([
    ['stats', get.projectStats],
    ['summaries', get.projectSummaries],
  ] as const)(
    'GET /api/%s/project/[BRAVO project] → 404, no BRAVO data',
    async (_name, route) => {
      const res = await route(alphaKey, B().projectId)
      expect(res.status).toBe(404)
      expect(res.text).not.toContain(BRAVO_MARK)
    }
  )

  it.each([
    ['stats', get.projectStats],
    ['summaries', get.projectSummaries],
  ] as const)(
    'GET /api/%s/project/[BRAVO project] → 404 for the dual member’s ALPHA-bound key, even though they are a BRAVO member',
    async (_name, route) => {
      const res = await route(
        { caller: 'dualAlpha', source: 'bearer', activeSlug: SLUG.bravo },
        B().projectId
      )
      expect(res.status).toBe(404)
      expect(res.text).not.toContain(BRAVO_MARK)
    }
  )

  it('GET /api/drafts?workspaceUrl=<BRAVO slug> → 404 for an ALPHA key', async () => {
    const res = await get.drafts(alphaKey, `?workspaceUrl=${SLUG.bravo}`)
    expect(res.status).toBe(404)
    expect(res.text).not.toContain(BRAVO_MARK)
    const dual = await get.drafts(
      { caller: 'dualAlpha', source: 'bearer' },
      `?workspaceUrl=${SLUG.bravo}`
    )
    expect(dual.status).toBe(404)
    expect(dual.text).not.toContain(BRAVO_MARK)
  })

  it('the X-Lumo-Workspace header cannot move the dual member’s ALPHA-bound key to BRAVO (collection routes)', async () => {
    const as: As = {
      caller: 'dualAlpha',
      source: 'bearer',
      activeSlug: SLUG.bravo,
    }
    const drafts = await get.drafts(as)
    expect(drafts.status).toBe(200)
    expect(drafts.text).toContain('dual-alpha draft')
    for (const res of [await get.notifications(as), drafts]) {
      expect(res.status).toBe(200)
      expect(res.text).not.toContain(BRAVO_MARK)
    }
  })
})

describe('LUM-1192 browser sessions keep working (active workspace)', () => {
  it('Clerk session on the dual member’s BRAVO page reads BRAVO; on ALPHA reads ALPHA', async () => {
    const bravo: As = {
      caller: 'dualAlpha',
      source: 'clerk',
      activeSlug: SLUG.bravo,
    }
    expect(
      (await get.drafts(bravo, `?workspaceUrl=${SLUG.bravo}`)).text
    ).toContain(`${BRAVO_MARK} dual draft`)
    const alpha: As = { ...bravo, activeSlug: SLUG.alpha }
    const res = await get.projectStats(alpha, A().projectId)
    expect(res.status).toBe(200)
    expect(res.text).not.toContain(BRAVO_MARK)
    expect((await get.projectStats(alpha, B().projectId)).status).toBe(404)
  })

  it('no credential → 401', async () => {
    const request = new NextRequest('http://localhost/api/notifications')
    inflight.headers = request.headers
    clerkSession.userId = null
    expect((await notificationsRoute.GET(request)).status).toBe(401)
  })
})

describe('LUM-1192 write methods stay browser-only', () => {
  it('PATCH /api/notifications with an API key → 401, nothing marked read', async () => {
    const res = await call(
      notificationsRoute.PATCH,
      'PATCH',
      '/api/notifications',
      {},
      alphaKey
    )
    expect(res.status).toBe(401)
    const unread = await harness.prisma!.notification.count({
      where: { workspaceId: A().workspaceId, read: false },
    })
    expect(unread).toBeGreaterThan(0)
  })
})

describe('LUM-1192 the CLI views render the same payload the web reads', () => {
  it('inbox / drafts / project views carry the route’s data', async () => {
    const inbox = (await get.notifications(alphaKey)).json() as Parameters<
      typeof formatInbox
    >[0]
    const inboxText = formatInbox(inbox)
    expect(inboxText).toContain('1 notification, 1 unread')
    expect(inboxText).toContain(
      'Lumo AI assigned you to HDL-1 alpha-own task one'
    )

    const drafts = (await get.drafts(alphaKey)).json() as {
      drafts: Parameters<typeof formatDraftList>[0]
    }
    expect(formatDraftList(drafts.drafts, { tty: false })).toMatch(
      /TASK\s+.+alpha-owner draft$/
    )

    const ps = (await get.projectStats(alphaKey, A().projectId)).json() as {
      stats: Parameters<typeof formatProjectOverview>[1]
    }
    const pText = formatProjectOverview(
      'alpha-own project',
      ps.stats,
      null,
      new Date()
    )
    expect(pText).toContain(
      'Stalled 0 · High stakes 0 · Stale PRs 0 · Overdue 0'
    )
    expect(pText).toMatch(/Total tasks:\s+1\b/)
  })
})
