/**
 * @jest-environment node
 *
 * LUM-978 — cross-tenant IDOR regression suite.
 *
 * Two workspaces, ALPHA and BRAVO. A caller authenticated as ALPHA — through a
 * Clerk browser session or a Bearer API key — must not read, update or delete
 * BRAVO's resources through the API. A missing `workspaceId` filter in a
 * repository `where` must fail this suite, not reach customers.
 *
 * Faithfulness: the REAL route handlers, services and repositories run against
 * a REAL Postgres (every prisma migration replayed into PGlite, see
 * scripts/test-support/pglite-harness.ts), read through the production
 * soft-delete extension. Nothing on the data path is mocked; the only stubs are
 * the identity provider (Clerk's `auth()` / profile lookups — no network) and
 * outbound side effects (realtime push, background `waitUntil`). The Bearer
 * path is fully real: the token's sha256 is looked up in `api_keys`.
 *
 * "Denied" = 403 or 404 (either is acceptable), AND the response body carries
 * none of BRAVO's data, AND (for writes) BRAVO's rows are byte-for-byte the
 * same afterwards. Every resource also has a fixture control: BRAVO's own
 * owner reads the same route and gets 200 with BRAVO's data, so a denial
 * cannot pass vacuously (e.g. because the fixture never resolved).
 *
 * Both workspaces deliberately share the team identifier `IDOR`, so
 * identifier-addressed routes (`IDOR-2`, `IDOR-I2`) are only safe if the
 * lookup is scoped to the caller's workspace.
 *
 * Fixture tokens are plain readable strings, not secret-shaped.
 */
import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { createPgliteHarness } from '../../scripts/test-support/pglite-harness'
import { withSoftDelete } from '@/lib/db/soft-delete'

// jest.setup.js mocks PrismaClient globally; this suite needs the real one.
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

// Identity provider stub: `auth()` reports whichever Clerk user the current
// case authenticates as (null for Bearer cases, so the Clerk fallback can
// never mask a Bearer decision). Profile lookups return nothing (no network).
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
// ESM-only outbound GitHub auth (never reached on a denied path).
jest.mock('@octokit/auth-app', () => ({ createAppAuth: jest.fn() }))
// ESM-only headless-browser link preview fetcher (outbound only).
jest.mock('@/lib/integrations/og-metadata/fetch-chromium', () => ({
  fetchOpenGraphChromium: jest.fn(),
}))
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: unknown) => {
    void Promise.resolve(p).catch(() => {})
  },
}))

// LUM-987: `headers()` (next/headers) reads the in-flight request through
// Next's request scope, which a directly-invoked handler doesn't have. Serve
// the headers of the request `call()` is dispatching — what Next itself does.
const inflight: { headers: Headers } = { headers: new Headers() }
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => inflight.headers),
}))

import * as taskRoute from '@/app/api/tasks/[id]/route'
import * as taskByIdentifierRoute from '@/app/api/tasks/by-identifier/[identifier]/route'
import * as projectRoute from '@/app/api/projects/[id]/route'
import * as documentRoute from '@/app/api/documents/[id]/route'
import * as documentMoveRoute from '@/app/api/documents/[id]/move/route'
import * as taskCommentsRoute from '@/app/api/tasks/[id]/comments/route'
import * as taskCommentRoute from '@/app/api/tasks/[id]/comments/[commentId]/route'
import * as milestoneRoute from '@/app/api/milestones/[milestoneId]/route'
import * as sprintRoute from '@/app/api/sprints/[sprintId]/route'
import * as ideaRoute from '@/app/api/ideas/[id]/route'
import * as ideaCommentsRoute from '@/app/api/ideas/[id]/comments/route'
import * as memoryRoute from '@/app/api/memories/[memoryId]/route'
import * as apiKeysRoute from '@/app/api/users/api-keys/route'
import * as apiKeyRoute from '@/app/api/users/api-keys/[id]/route'
import * as teamTasksRoute from '@/app/api/teams/[teamId]/tasks/route'
import * as teamSprintsRoute from '@/app/api/teams/[teamId]/sprints/route'
import * as teamCadenceRoute from '@/app/api/teams/[teamId]/cadence/route'
import * as sprintBurnupRoute from '@/app/api/sprints/[sprintId]/burnup/route'
import * as sprintCloseRoute from '@/app/api/sprints/[sprintId]/close/route'
import * as sprintStartRoute from '@/app/api/sprints/[sprintId]/start/route'
import * as sprintSummaryRoute from '@/app/api/sprints/[sprintId]/summary/route'
import * as sprintSummaryRetryRoute from '@/app/api/sprints/[sprintId]/summary/retry/route'
import * as sprintTasksRoute from '@/app/api/sprints/[sprintId]/tasks/route'
import * as sprintTaskRoute from '@/app/api/sprints/[sprintId]/tasks/[taskId]/route'
import * as sprintTeamPerfRoute from '@/app/api/sprints/[sprintId]/team-performance/route'
import * as sprintByNumberRoute from '@/app/api/sprints/by-number/route'
import * as projectMilestonesRoute from '@/app/api/projects/[id]/milestones/route'
import * as projectMilestonesReorderRoute from '@/app/api/projects/[id]/milestones/reorder/route'
import * as projectMilestoneBySlugRoute from '@/app/api/projects/[id]/milestones/by-slug/[slug]/route'
import * as taskWebLinksRoute from '@/app/api/tasks/[id]/web-links/route'
import * as taskProgressRoute from '@/app/api/tasks/[id]/progress/route'
import * as sessionRawRecordRoute from '@/app/api/sessions/[sessionId]/raw-record/route'
import * as projectTasksRoute from '@/app/api/projects/[id]/tasks/route'
import * as draftsRoute from '@/app/api/drafts/route'
import * as documentsRoute from '@/app/api/documents/route'
import * as documentTreeRoute from '@/app/api/documents/tree/route'
import { getUserWorkspace } from '@/lib/auth'

jest.setTimeout(240_000)

// ── Fixture ──────────────────────────────────────────────────────────────────

/** Every BRAVO string carries this marker; it must never reach an ALPHA caller. */
const BRAVO_MARK = 'bravo-private'
/** ALPHA's second team, which the plain ALPHA member is NOT a TeamMember of. */
const RESTRICTED_MARK = 'alpha-restricted-team'

/** LUM-985: one human who is a member of BOTH workspaces. */
const DUAL_CLERK = 'user_idor_dual_member'
const CLERK = {
  alphaOwner: 'user_idor_alpha_owner',
  alphaMember: 'user_idor_alpha_member',
  bravoOwner: 'user_idor_bravo_owner',
  dualAlpha: DUAL_CLERK,
  dualBravo: DUAL_CLERK,
}
/** Readable, non-secret-shaped fixture tokens (only their sha256 is stored). */
const TOKEN = {
  alphaOwner: 'idor-fixture-bearer-alpha-owner',
  alphaMember: 'idor-fixture-bearer-alpha-member',
  bravoOwner: 'idor-fixture-bearer-bravo-owner',
  /** The dual member's key bound to ALPHA (the credential under test). */
  dualAlpha: 'idor-fixture-bearer-dual-alpha',
  /** The dual member's key bound to BRAVO (non-vacuity control). */
  dualBravo: 'idor-fixture-bearer-dual-bravo',
}

interface WorkspaceFixture {
  workspaceId: string
  ownerMemberId: string
  teamId: string
  projectId: string
  milestoneId: string
  sprintId: string
  taskId: string
  /** A task number that exists in BRAVO but not in ALPHA (identifier probe). */
  taskIdentifier: string
  commentId: string
  documentId: string
  documentSlug: string
  ideaId: string
  ideaRef: string
  memoryId: string
  apiKeyId: string
}

type DualProbes = Record<
  'clerk' | 'bearer',
  /** A BRAVO task in BRAVO's sprint; a DRAFT BRAVO sprint to delete. */
  { sprintTaskId: string; deleteSprintId: string }
>

const fx: {
  alpha: WorkspaceFixture | null
  bravo: WorkspaceFixture | null
  restricted: { teamId: string; sprintId: string; taskId: string } | null
  alphaMemberTeamId: string | null
  /** LUM-985: per-source BRAVO probes for the destructive dual-member cases. */
  dualProbes: DualProbes | null
} = {
  alpha: null,
  bravo: null,
  restricted: null,
  alphaMemberTeamId: null,
  dualProbes: null,
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

async function seedWorkspace(
  label: 'alpha' | 'bravo',
  ownerClerkId: string,
  ownerToken: string,
  /** BRAVO gets one extra task / idea so `IDOR-2` / `IDOR-I2` exist only there. */
  extra: boolean
): Promise<WorkspaceFixture> {
  const db = harness.prisma!
  const mark = label === 'bravo' ? BRAVO_MARK : 'alpha-own'
  const ws = await db.workspace.create({
    data: { name: `${mark} workspace`, slug: `idor-${label}` },
  })
  const owner = await db.workspaceMember.create({
    data: { workspaceId: ws.id, clerkId: ownerClerkId, role: 'OWNER' },
  })
  const actor = await db.actor.create({
    data: { workspaceId: ws.id, type: 'HUMAN', memberId: owner.id },
  })
  const team = await db.team.create({
    data: {
      workspaceId: ws.id,
      name: `${mark} team`,
      identifier: 'IDOR',
      isDefault: true,
    },
  })
  await db.teamMember.create({ data: { teamId: team.id, memberId: owner.id } })
  const project = await db.project.create({
    data: {
      workspaceId: ws.id,
      teamId: team.id,
      createdByMemberId: owner.id,
      name: `${mark} project`,
    },
  })
  const milestone = await db.milestone.create({
    data: {
      projectId: project.id,
      name: `${mark} milestone`,
      slug: `${label}-milestone`,
    },
  })
  const sprint = await db.sprint.create({
    data: {
      teamId: team.id,
      number: 1,
      name: `${mark} sprint`,
      startDate: new Date('2030-01-06T00:00:00.000Z'),
      endDate: new Date('2030-01-20T00:00:00.000Z'),
    },
  })
  const task = await db.task.create({
    data: {
      projectId: project.id,
      teamId: team.id,
      number: 1,
      title: `${mark} task one`,
      description: `${mark} task description`,
      milestoneId: milestone.id,
    },
  })
  let probeNumber = 1
  if (extra) {
    await db.task.create({
      data: {
        projectId: project.id,
        teamId: team.id,
        number: 2,
        title: `${mark} task two`,
      },
    })
    probeNumber = 2
  }
  const comment = await db.comment.create({
    data: {
      taskId: task.id,
      authorActorId: actor.id,
      body: `<p>${mark} comment body</p>`,
    },
  })
  const document = await db.document.create({
    data: {
      workspaceId: ws.id,
      createdById: owner.id,
      number: 1,
      slug: `${label}-doc`,
      title: `${mark} document`,
      content: `<p>${mark} document content</p>`,
      visibility: 'WORKSPACE',
    },
  })
  const idea = await db.idea.create({
    data: {
      teamId: team.id,
      workspaceId: ws.id,
      number: 1,
      statement: `${mark} idea one`,
      proposedByMemberId: owner.id,
    },
  })
  let ideaProbe = 1
  const ideaIds = [idea.id]
  if (extra) {
    const two = await db.idea.create({
      data: {
        teamId: team.id,
        workspaceId: ws.id,
        number: 2,
        statement: `${mark} idea two`,
        proposedByMemberId: owner.id,
      },
    })
    ideaProbe = 2
    ideaIds.push(two.id)
  }
  for (const ideaId of ideaIds) {
    await db.comment.create({
      data: {
        ideaId,
        authorActorId: actor.id,
        body: `<p>${mark} idea comment</p>`,
      },
    })
  }
  const memory = await db.memory.create({
    data: {
      workspaceId: ws.id,
      projectId: project.id,
      scope: 'PROJECT',
      category: 'CONVENTION',
      content: { rule: `${mark} memory rule`, scope: `${mark} scope` },
      createdByMemberId: owner.id,
    },
  })
  const apiKey = await db.apiKey.create({
    data: {
      workspaceMemberId: owner.id,
      label: `${mark} laptop key`,
      keyHash: sha256(ownerToken),
      keyPrefix: ownerToken.slice(0, 16),
    },
  })
  return {
    workspaceId: ws.id,
    ownerMemberId: owner.id,
    teamId: team.id,
    projectId: project.id,
    milestoneId: milestone.id,
    sprintId: sprint.id,
    taskId: task.id,
    taskIdentifier: `IDOR-${probeNumber}`,
    commentId: comment.id,
    documentId: document.id,
    documentSlug: document.slug,
    ideaId: idea.id,
    ideaRef: `IDOR-I${ideaProbe}`,
    memoryId: memory.id,
    apiKeyId: apiKey.id,
  }
}

/** ALPHA's team layer: a plain MEMBER who belongs to the default team only. */
async function seedAlphaTeamLayer(alpha: WorkspaceFixture) {
  const db = harness.prisma!
  const member = await db.workspaceMember.create({
    data: {
      workspaceId: alpha.workspaceId,
      clerkId: CLERK.alphaMember,
      role: 'MEMBER',
    },
  })
  await db.actor.create({
    data: {
      workspaceId: alpha.workspaceId,
      type: 'HUMAN',
      memberId: member.id,
    },
  })
  await db.teamMember.create({
    data: { teamId: alpha.teamId, memberId: member.id },
  })
  await db.apiKey.create({
    data: {
      workspaceMemberId: member.id,
      label: 'alpha member key',
      keyHash: sha256(TOKEN.alphaMember),
      keyPrefix: TOKEN.alphaMember.slice(0, 16),
    },
  })
  const team = await db.team.create({
    data: {
      workspaceId: alpha.workspaceId,
      name: `${RESTRICTED_MARK} name`,
      identifier: 'RSTR',
    },
  })
  // The owner is on it; the plain member is not.
  await db.teamMember.create({
    data: { teamId: team.id, memberId: alpha.ownerMemberId },
  })
  const project = await db.project.create({
    data: {
      workspaceId: alpha.workspaceId,
      teamId: team.id,
      createdByMemberId: alpha.ownerMemberId,
      name: `${RESTRICTED_MARK} project`,
    },
  })
  const sprint = await db.sprint.create({
    data: {
      teamId: team.id,
      number: 1,
      name: `${RESTRICTED_MARK} sprint`,
      startDate: new Date('2030-01-06T00:00:00.000Z'),
      endDate: new Date('2030-01-20T00:00:00.000Z'),
    },
  })
  const task = await db.task.create({
    data: {
      projectId: project.id,
      teamId: team.id,
      number: 1,
      title: `${RESTRICTED_MARK} task`,
      sprintId: sprint.id,
    },
  })
  return { teamId: team.id, sprintId: sprint.id, taskId: task.id }
}

/**
 * LUM-985: a human who is a MEMBER of both workspaces and a TeamMember of each
 * workspace's default team — so in BRAVO they are legitimately allowed, and the
 * only thing that may deny an ALPHA-bound credential is its workspace scope.
 * ALPHA's membership row is created first so the Clerk path (which resolves the
 * user's workspace via `getUserWorkspace`) lands on ALPHA; a test asserts it.
 */
async function seedDualMember(
  alpha: WorkspaceFixture,
  bravo: WorkspaceFixture
) {
  const db = harness.prisma!
  for (const [ws, token] of [
    [alpha, TOKEN.dualAlpha],
    [bravo, TOKEN.dualBravo],
  ] as const) {
    const member = await db.workspaceMember.create({
      data: {
        workspaceId: ws.workspaceId,
        clerkId: DUAL_CLERK,
        role: 'MEMBER',
      },
    })
    await db.actor.create({
      data: { workspaceId: ws.workspaceId, type: 'HUMAN', memberId: member.id },
    })
    await db.teamMember.create({
      data: { teamId: ws.teamId, memberId: member.id },
    })
    await db.apiKey.create({
      data: {
        workspaceMemberId: member.id,
        label: 'dual member key',
        keyHash: sha256(token),
        keyPrefix: token.slice(0, 16),
      },
    })
  }
  // Per-source probes for the destructive cases, so that on an unfixed run
  // the Clerk case removing them can't make the Bearer case pass vacuously.
  const probes = {} as DualProbes
  let taskNumber = 3
  let sprintNumber = 2
  for (const source of ['clerk', 'bearer'] as const) {
    const sprintTask = await db.task.create({
      data: {
        projectId: bravo.projectId,
        teamId: bravo.teamId,
        number: taskNumber++,
        title: `${BRAVO_MARK} sprint task (${source})`,
        sprintId: bravo.sprintId,
      },
    })
    const deleteSprint = await db.sprint.create({
      data: {
        teamId: bravo.teamId,
        number: sprintNumber++,
        name: `${BRAVO_MARK} delete-probe sprint (${source})`,
        startDate: new Date(`2032-0${sprintNumber}-01T00:00:00.000Z`),
        endDate: new Date(`2032-0${sprintNumber}-10T00:00:00.000Z`),
      },
    })
    probes[source] = {
      sprintTaskId: sprintTask.id,
      deleteSprintId: deleteSprint.id,
    }
  }
  return probes
}

/**
 * Everything of BRAVO's (and of ALPHA's restricted team) a write could touch.
 * Compared before/after every denied write: a denial that still mutated is a
 * failure even if the status code says 403/404.
 */
async function snapshotProtected() {
  const db = harness.prisma!
  const b = fx.bravo!
  const r = fx.restricted!
  const [
    tasks,
    project,
    milestone,
    sprints,
    comments,
    document,
    ideas,
    memory,
    apiKey,
  ] = await Promise.all([
    db.task.findMany({
      where: { teamId: { in: [b.teamId, r.teamId] } },
      select: { id: true, title: true, status: true, deletedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.project.findUnique({
      where: { id: b.projectId },
      select: { name: true, description: true },
    }),
    db.milestone.findUnique({
      where: { id: b.milestoneId },
      select: { name: true, description: true, archivedAt: true },
    }),
    db.sprint.findMany({
      where: { teamId: { in: [b.teamId, r.teamId] } },
      select: { id: true, name: true, status: true, startDate: true },
      orderBy: { id: 'asc' },
    }),
    db.comment.findMany({
      where: {
        OR: [{ task: { teamId: b.teamId } }, { idea: { teamId: b.teamId } }],
      },
      select: { id: true, body: true, deletedAt: true },
      orderBy: { id: 'asc' },
    }),
    db.document.findUnique({
      where: { id: b.documentId },
      select: { title: true, content: true, deletedAt: true },
    }),
    db.idea.findMany({
      where: { teamId: b.teamId },
      select: { id: true, statement: true, status: true },
      orderBy: { id: 'asc' },
    }),
    db.memory.findUnique({
      where: { id: b.memoryId },
      select: { content: true, status: true, scope: true },
    }),
    db.apiKey.findUnique({
      where: { id: b.apiKeyId },
      select: { revokedAt: true },
    }),
  ])
  return {
    tasks,
    project,
    milestone,
    sprints,
    comments,
    document,
    ideas,
    memory,
    apiKey,
  }
}

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  fx.alpha = await seedWorkspace(
    'alpha',
    CLERK.alphaOwner,
    TOKEN.alphaOwner,
    false
  )
  fx.bravo = await seedWorkspace(
    'bravo',
    CLERK.bravoOwner,
    TOKEN.bravoOwner,
    true
  )
  fx.restricted = await seedAlphaTeamLayer(fx.alpha)
  fx.alphaMemberTeamId = fx.alpha.teamId
  fx.dualProbes = await seedDualMember(fx.alpha, fx.bravo)
})

afterAll(async () => {
  await harness.stop()
})

// ── Request plumbing ────────────────────────────────────────────────────────

type AuthSource = 'clerk' | 'bearer'
type Caller =
  | 'alphaOwner'
  | 'alphaMember'
  | 'bravoOwner'
  | 'dualAlpha'
  | 'dualBravo'
type Handler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>

async function call(
  handler: unknown,
  method: string,
  path: string,
  params: Record<string, string>,
  as: { caller: Caller; source: AuthSource; activeSlug?: string },
  body?: unknown
): Promise<{ status: number; text: string }> {
  clerkSession.userId = as.source === 'clerk' ? CLERK[as.caller] : null
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (as.source === 'bearer')
    headers.authorization = `Bearer ${TOKEN[as.caller]}`
  // LUM-987: the slug the browser's apiFetch sends from /workspace/<slug>/….
  if (as.activeSlug) headers['x-lumo-workspace'] = as.activeSlug
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  inflight.headers = request.headers
  const res = await (handler as Handler)(request, {
    params: Promise.resolve(params),
  })
  const text = res.status === 204 ? '' : await res.text()
  return { status: res.status, text }
}

// ── The matrix ──────────────────────────────────────────────────────────────

type Verb = 'read' | 'update' | 'delete'
interface DeniedCase {
  resource: string
  verb: Verb
  source: AuthSource
  route: string
  /** Who calls: ALPHA's owner (cross-tenant) or ALPHA's plain member (team layer). */
  caller?: Caller
  /** Marker that must not appear in the response body. */
  mark?: string
  run: (as: { caller: Caller; source: AuthSource }) => Promise<{
    status: number
    text: string
  }>
}

const B = () => fx.bravo!
const A = () => fx.alpha!
const R = () => fx.restricted!
const BOTH: AuthSource[] = ['clerk', 'bearer']

function crossTenantCases(): DeniedCase[] {
  const cases: DeniedCase[] = []
  const add = (
    resource: string,
    verb: Verb,
    sources: AuthSource[],
    route: string,
    run: DeniedCase['run']
  ) => {
    for (const source of sources)
      cases.push({ resource, verb, source, route, run })
  }

  // task — web routes are Clerk-only (cuid); the CLI routes are Bearer-only
  // (identifier). `IDOR-2` exists only in BRAVO.
  add('task', 'read', ['clerk'], 'GET /api/tasks/[id]', as =>
    call(
      taskRoute.GET,
      'GET',
      `/api/tasks/${B().taskId}`,
      { id: B().taskId },
      as
    )
  )
  add('task', 'update', ['clerk'], 'PATCH /api/tasks/[id]', as =>
    call(
      taskRoute.PATCH,
      'PATCH',
      `/api/tasks/${B().taskId}`,
      { id: B().taskId },
      as,
      {
        title: 'pwned by alpha',
      }
    )
  )
  add('task', 'delete', ['clerk'], 'DELETE /api/tasks/[id]', as =>
    call(
      taskRoute.DELETE,
      'DELETE',
      `/api/tasks/${B().taskId}`,
      { id: B().taskId },
      as
    )
  )
  add(
    'task',
    'read',
    ['bearer'],
    'GET /api/tasks/by-identifier/[identifier]',
    as =>
      call(
        taskByIdentifierRoute.GET,
        'GET',
        `/api/tasks/by-identifier/${B().taskIdentifier}`,
        { identifier: B().taskIdentifier },
        as
      )
  )
  add(
    'task',
    'update',
    ['bearer'],
    'PATCH /api/tasks/by-identifier/[identifier]',
    as =>
      call(
        taskByIdentifierRoute.PATCH,
        'PATCH',
        `/api/tasks/by-identifier/${B().taskIdentifier}`,
        { identifier: B().taskIdentifier },
        as,
        { title: 'pwned by alpha' }
      )
  )
  add(
    'task',
    'delete',
    ['bearer'],
    'DELETE /api/tasks/by-identifier/[identifier]',
    as =>
      call(
        taskByIdentifierRoute.DELETE,
        'DELETE',
        `/api/tasks/by-identifier/${B().taskIdentifier}`,
        { identifier: B().taskIdentifier },
        as
      )
  )

  // project — GET/DELETE are Clerk-only; PATCH takes both.
  add('project', 'read', ['clerk'], 'GET /api/projects/[id]', as =>
    call(
      projectRoute.GET,
      'GET',
      `/api/projects/${B().projectId}`,
      { id: B().projectId },
      as
    )
  )
  add('project', 'update', BOTH, 'PATCH /api/projects/[id]', as =>
    call(
      projectRoute.PATCH,
      'PATCH',
      `/api/projects/${B().projectId}`,
      { id: B().projectId },
      as,
      { name: 'pwned by alpha' }
    )
  )
  add('project', 'delete', ['clerk'], 'DELETE /api/projects/[id]', as =>
    call(
      projectRoute.DELETE,
      'DELETE',
      `/api/projects/${B().projectId}`,
      { id: B().projectId },
      as
    )
  )

  // doc — by cuid; the slug form is probed too (`findWithPermission` accepts both).
  add('doc', 'read', BOTH, 'GET /api/documents/[id]', as =>
    call(
      documentRoute.GET,
      'GET',
      `/api/documents/${B().documentId}`,
      { id: B().documentId },
      as
    )
  )
  add('doc', 'read', BOTH, 'GET /api/documents/[slug]', as =>
    call(
      documentRoute.GET,
      'GET',
      `/api/documents/${B().documentSlug}`,
      { id: B().documentSlug },
      as
    )
  )
  add('doc', 'update', BOTH, 'PATCH /api/documents/[id]', as =>
    call(
      documentRoute.PATCH,
      'PATCH',
      `/api/documents/${B().documentId}`,
      { id: B().documentId },
      as,
      { title: 'pwned by alpha' }
    )
  )
  add('doc', 'delete', BOTH, 'DELETE /api/documents/[id]', as =>
    call(
      documentRoute.DELETE,
      'DELETE',
      `/api/documents/${B().documentId}`,
      { id: B().documentId },
      as
    )
  )

  // comment — read is the task's thread; edit/delete are by (task, comment).
  add('comment', 'read', BOTH, 'GET /api/tasks/[id]/comments', as =>
    call(
      taskCommentsRoute.GET,
      'GET',
      `/api/tasks/${B().taskId}/comments`,
      { id: B().taskId },
      as
    )
  )
  add(
    'comment',
    'update',
    BOTH,
    'PATCH /api/tasks/[id]/comments/[commentId]',
    as =>
      call(
        taskCommentRoute.PATCH,
        'PATCH',
        `/api/tasks/${B().taskId}/comments/${B().commentId}`,
        { id: B().taskId, commentId: B().commentId },
        as,
        { body: '<p>pwned by alpha</p>' }
      )
  )
  // Mixed probe: ALPHA's own task id + BRAVO's comment id.
  add(
    'comment',
    'update',
    BOTH,
    'PATCH /api/tasks/[own task]/comments/[foreign commentId]',
    as =>
      call(
        taskCommentRoute.PATCH,
        'PATCH',
        `/api/tasks/${A().taskId}/comments/${B().commentId}`,
        { id: A().taskId, commentId: B().commentId },
        as,
        { body: '<p>pwned by alpha</p>' }
      )
  )
  add(
    'comment',
    'delete',
    BOTH,
    'DELETE /api/tasks/[id]/comments/[commentId]',
    as =>
      call(
        taskCommentRoute.DELETE,
        'DELETE',
        `/api/tasks/${B().taskId}/comments/${B().commentId}`,
        { id: B().taskId, commentId: B().commentId },
        as
      )
  )

  // milestone
  add('milestone', 'read', BOTH, 'GET /api/milestones/[milestoneId]', as =>
    call(
      milestoneRoute.GET,
      'GET',
      `/api/milestones/${B().milestoneId}`,
      { milestoneId: B().milestoneId },
      as
    )
  )
  add('milestone', 'update', BOTH, 'PATCH /api/milestones/[milestoneId]', as =>
    call(
      milestoneRoute.PATCH,
      'PATCH',
      `/api/milestones/${B().milestoneId}`,
      { milestoneId: B().milestoneId },
      as,
      { name: 'pwned by alpha' }
    )
  )
  add('milestone', 'delete', BOTH, 'DELETE /api/milestones/[milestoneId]', as =>
    call(
      milestoneRoute.DELETE,
      'DELETE',
      `/api/milestones/${B().milestoneId}`,
      { milestoneId: B().milestoneId },
      as
    )
  )

  // sprint
  add('sprint', 'read', BOTH, 'GET /api/sprints/[sprintId]', as =>
    call(
      sprintRoute.GET,
      'GET',
      `/api/sprints/${B().sprintId}`,
      { sprintId: B().sprintId },
      as
    )
  )
  add('sprint', 'update', BOTH, 'PATCH /api/sprints/[sprintId]', as =>
    call(
      sprintRoute.PATCH,
      'PATCH',
      `/api/sprints/${B().sprintId}`,
      { sprintId: B().sprintId },
      as,
      { name: 'pwned by alpha' }
    )
  )
  add('sprint', 'delete', BOTH, 'DELETE /api/sprints/[sprintId]', as =>
    call(
      sprintRoute.DELETE,
      'DELETE',
      `/api/sprints/${B().sprintId}`,
      { sprintId: B().sprintId },
      as
    )
  )

  // idea — no per-idea GET or DELETE route exists; read = its comment thread,
  // "delete" = the DROPPED lifecycle move. Probed by cuid and by `IDOR-I2`.
  add('idea', 'read', BOTH, 'GET /api/ideas/[id]/comments (cuid)', as =>
    call(
      ideaCommentsRoute.GET,
      'GET',
      `/api/ideas/${B().ideaId}/comments`,
      { id: B().ideaId },
      as
    )
  )
  add('idea', 'read', BOTH, 'GET /api/ideas/[IDOR-I2]/comments', as =>
    call(
      ideaCommentsRoute.GET,
      'GET',
      `/api/ideas/${B().ideaRef}/comments`,
      { id: B().ideaRef },
      as
    )
  )
  add('idea', 'update', BOTH, 'PATCH /api/ideas/[id] {statement}', as =>
    call(
      ideaRoute.PATCH,
      'PATCH',
      `/api/ideas/${B().ideaId}`,
      { id: B().ideaId },
      as,
      {
        statement: 'pwned by alpha',
      }
    )
  )
  add('idea', 'update', BOTH, 'PATCH /api/ideas/[IDOR-I2] {status}', as =>
    call(
      ideaRoute.PATCH,
      'PATCH',
      `/api/ideas/${B().ideaRef}`,
      { id: B().ideaRef },
      as,
      {
        status: 'DEVELOPING',
      }
    )
  )
  add('idea', 'delete', BOTH, 'PATCH /api/ideas/[id] {status: DROPPED}', as =>
    call(
      ideaRoute.PATCH,
      'PATCH',
      `/api/ideas/${B().ideaId}`,
      { id: B().ideaId },
      as,
      {
        status: 'DROPPED',
      }
    )
  )

  // memory
  add('memory', 'read', BOTH, 'GET /api/memories/[memoryId]', as =>
    call(
      memoryRoute.GET,
      'GET',
      `/api/memories/${B().memoryId}`,
      { memoryId: B().memoryId },
      as
    )
  )
  add('memory', 'update', BOTH, 'PATCH /api/memories/[memoryId]', as =>
    call(
      memoryRoute.PATCH,
      'PATCH',
      `/api/memories/${B().memoryId}`,
      { memoryId: B().memoryId },
      as,
      { content: { rule: 'pwned by alpha', scope: 'everything' } }
    )
  )
  add('memory', 'delete', BOTH, 'DELETE /api/memories/[memoryId]', as =>
    call(
      memoryRoute.DELETE,
      'DELETE',
      `/api/memories/${B().memoryId}`,
      { memoryId: B().memoryId },
      as
    )
  )

  // API key — management routes are Clerk-only. Delete = revoke BRAVO's key
  // by id; read (the caller's own key list) is asserted separately below.
  add('api-key', 'delete', ['clerk'], 'DELETE /api/users/api-keys/[id]', as =>
    call(
      apiKeyRoute.DELETE,
      'DELETE',
      `/api/users/api-keys/${B().apiKeyId}`,
      { id: B().apiKeyId },
      as
    )
  )

  // team layer across tenants: ALPHA's OWNER on BRAVO's team.
  add('team', 'read', BOTH, 'GET /api/teams/[teamId]/tasks', as =>
    call(
      teamTasksRoute.GET,
      'GET',
      `/api/teams/${B().teamId}/tasks`,
      { teamId: B().teamId },
      as
    )
  )
  add('team', 'read', BOTH, 'GET /api/teams/[teamId]/sprints', as =>
    call(
      teamSprintsRoute.GET,
      'GET',
      `/api/teams/${B().teamId}/sprints`,
      { teamId: B().teamId },
      as
    )
  )
  add('team', 'update', BOTH, 'POST /api/teams/[teamId]/sprints', as =>
    call(
      teamSprintsRoute.POST,
      'POST',
      `/api/teams/${B().teamId}/sprints`,
      { teamId: B().teamId },
      as,
      {}
    )
  )

  return cases
}

/** Same workspace, wrong team: ALPHA's plain MEMBER on ALPHA's restricted team. */
function teamLayerCases(): DeniedCase[] {
  const cases: DeniedCase[] = []
  const add = (verb: Verb, route: string, run: DeniedCase['run']) => {
    for (const source of BOTH)
      cases.push({
        resource: 'team-scoped',
        verb,
        source,
        route,
        caller: 'alphaMember',
        mark: RESTRICTED_MARK,
        run,
      })
  }
  add('read', 'GET /api/teams/[teamId]/tasks', as =>
    call(
      teamTasksRoute.GET,
      'GET',
      `/api/teams/${R().teamId}/tasks`,
      { teamId: R().teamId },
      as
    )
  )
  add('read', 'GET /api/teams/[teamId]/sprints', as =>
    call(
      teamSprintsRoute.GET,
      'GET',
      `/api/teams/${R().teamId}/sprints`,
      { teamId: R().teamId },
      as
    )
  )
  add('update', 'POST /api/teams/[teamId]/sprints', as =>
    call(
      teamSprintsRoute.POST,
      'POST',
      `/api/teams/${R().teamId}/sprints`,
      { teamId: R().teamId },
      as,
      {}
    )
  )
  add('read', 'GET /api/sprints/[sprintId]', as =>
    call(
      sprintRoute.GET,
      'GET',
      `/api/sprints/${R().sprintId}`,
      { sprintId: R().sprintId },
      as
    )
  )
  add('update', 'PATCH /api/sprints/[sprintId]', as =>
    call(
      sprintRoute.PATCH,
      'PATCH',
      `/api/sprints/${R().sprintId}`,
      { sprintId: R().sprintId },
      as,
      { name: 'pwned by member' }
    )
  )
  add('delete', 'DELETE /api/sprints/[sprintId]', as =>
    call(
      sprintRoute.DELETE,
      'DELETE',
      `/api/sprints/${R().sprintId}`,
      { sprintId: R().sprintId },
      as
    )
  )
  return cases
}

const caseName = (c: DeniedCase) =>
  `${c.resource} × ${c.verb} × ${c.source} — ${c.route}`

async function expectDenied(c: DeniedCase) {
  const caller = c.caller ?? 'alphaOwner'
  const before = await snapshotProtected()
  const res = await c.run({ caller, source: c.source })
  // Denied = 403 or 404; the received value names the real status on failure.
  expect(`${caseName(c)} → ${res.status}`).toMatch(/ → 40[34]$/)
  expect(res.text).not.toContain(c.mark ?? BRAVO_MARK)
  if (!c.mark) expect(res.text).not.toContain(CLERK.bravoOwner)
  expect(await snapshotProtected()).toEqual(before)
}

// Case tables are static; each `run` reads fixture ids only when it executes
// (they exist after beforeAll).
const CROSS = crossTenantCases()
const TEAM = teamLayerCases()

describe('LUM-978 cross-tenant IDOR: ALPHA cannot reach BRAVO', () => {
  it.each(CROSS.map(c => [caseName(c), c] as const))('%s', async (_n, c) => {
    await expectDenied(c)
  })
})

describe('LUM-978 cross-tenant IDOR: API key list', () => {
  // A list route has no "denied" status: the 200 must hold ALPHA's key only.
  it('api-key × read × clerk — GET /api/users/api-keys lists none of BRAVO’s keys', async () => {
    clerkSession.userId = CLERK.alphaOwner
    const res = await apiKeysRoute.GET()
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(text).toContain(A().apiKeyId)
    expect(text).not.toContain(B().apiKeyId)
    expect(text).not.toContain(BRAVO_MARK)
  })
})

describe('LUM-978 team layer: an ALPHA member without TeamMember on team T is denied T-scoped routes', () => {
  it.each(TEAM.map(c => [caseName(c), c] as const))('%s', async (_n, c) => {
    await expectDenied(c)
  })
})

// ── Fixture controls (non-vacuity) ──────────────────────────────────────────
// The resource owner reaching the same route gets 200 with the protected
// data — so every denial above is the tenant/team boundary, not a broken
// fixture or a route that 404s for everyone.

describe('LUM-978 fixture controls: the owning caller is allowed', () => {
  const owner = { caller: 'bravoOwner' as const }
  const reads: Array<
    [string, AuthSource, () => Promise<{ status: number; text: string }>]
  > = [
    [
      'task GET /api/tasks/[id]',
      'clerk',
      () =>
        call(
          taskRoute.GET,
          'GET',
          '/x',
          { id: B().taskId },
          { ...owner, source: 'clerk' }
        ),
    ],
    [
      'task GET /api/tasks/by-identifier',
      'bearer',
      () =>
        call(
          taskByIdentifierRoute.GET,
          'GET',
          '/x',
          { identifier: B().taskIdentifier },
          { ...owner, source: 'bearer' }
        ),
    ],
    [
      'project GET /api/projects/[id]',
      'clerk',
      () =>
        call(
          projectRoute.GET,
          'GET',
          '/x',
          { id: B().projectId },
          { ...owner, source: 'clerk' }
        ),
    ],
    [
      'doc GET /api/documents/[id]',
      'bearer',
      () =>
        call(
          documentRoute.GET,
          'GET',
          '/x',
          { id: B().documentId },
          { ...owner, source: 'bearer' }
        ),
    ],
    [
      'comment GET /api/tasks/[id]/comments',
      'bearer',
      () =>
        call(
          taskCommentsRoute.GET,
          'GET',
          '/x',
          { id: B().taskId },
          { ...owner, source: 'bearer' }
        ),
    ],
    [
      'milestone GET /api/milestones/[id]',
      'bearer',
      () =>
        call(
          milestoneRoute.GET,
          'GET',
          '/x',
          { milestoneId: B().milestoneId },
          { ...owner, source: 'bearer' }
        ),
    ],
    [
      'sprint GET /api/sprints/[id]',
      'bearer',
      () =>
        call(
          sprintRoute.GET,
          'GET',
          '/x',
          { sprintId: B().sprintId },
          { ...owner, source: 'bearer' }
        ),
    ],
    [
      'idea GET /api/ideas/[IDOR-I2]/comments',
      'bearer',
      () =>
        call(
          ideaCommentsRoute.GET,
          'GET',
          '/x',
          { id: B().ideaRef },
          { ...owner, source: 'bearer' }
        ),
    ],
    [
      'idea GET /api/ideas/[id]/comments',
      'clerk',
      () =>
        call(
          ideaCommentsRoute.GET,
          'GET',
          '/x',
          { id: B().ideaId },
          { ...owner, source: 'clerk' }
        ),
    ],
    [
      'memory GET /api/memories/[id]',
      'bearer',
      () =>
        call(
          memoryRoute.GET,
          'GET',
          '/x',
          { memoryId: B().memoryId },
          { ...owner, source: 'bearer' }
        ),
    ],
    [
      'team GET /api/teams/[teamId]/tasks',
      'bearer',
      () =>
        call(
          teamTasksRoute.GET,
          'GET',
          '/x',
          { teamId: B().teamId },
          { ...owner, source: 'bearer' }
        ),
    ],
  ]
  it.each(reads)(
    'BRAVO owner: %s (%s) → 200 with BRAVO data',
    async (_n, _s, run) => {
      const res = await run()
      expect(res.status).toBe(200)
      expect(res.text).toContain(BRAVO_MARK)
    }
  )

  it('BRAVO owner: GET /api/users/api-keys lists BRAVO key', async () => {
    clerkSession.userId = CLERK.bravoOwner
    const res = await apiKeysRoute.GET()
    expect(res.status).toBe(200)
    expect(await res.text()).toContain(BRAVO_MARK)
  })

  it.each(BOTH)(
    'ALPHA member (%s): own team T1 is reachable while restricted team T2 is not',
    async source => {
      const own = await call(
        teamTasksRoute.GET,
        'GET',
        '/x',
        { teamId: fx.alphaMemberTeamId! },
        { caller: 'alphaMember', source }
      )
      expect(own.status).toBe(200)
      expect(own.text).toContain('alpha-own task one')
      // …and ALPHA's OWNER reaches the restricted team (OWNER = all teams).
      const ownerView = await call(
        teamTasksRoute.GET,
        'GET',
        '/x',
        { teamId: R().teamId },
        { caller: 'alphaOwner', source }
      )
      expect(ownerView.status).toBe(200)
      expect(ownerView.text).toContain(RESTRICTED_MARK)
    }
  )

  // The identifier route is Bearer-only.
  it('ALPHA owner (bearer): the shared identifier IDOR-1 resolves to ALPHA’s own task, never BRAVO’s', async () => {
    const res = await call(
      taskByIdentifierRoute.GET,
      'GET',
      '/x',
      { identifier: 'IDOR-1' },
      { caller: 'alphaOwner', source: 'bearer' }
    )
    expect(res.status).toBe(200)
    expect(res.text).toContain('alpha-own task one')
    expect(res.text).not.toContain(BRAVO_MARK)
  })
})

// ── LUM-985: credential workspace scope on team-scoped routes ───────────────
// A human who belongs to BOTH workspaces (and to BRAVO's team) calls with a
// credential scoped to ALPHA — an ALPHA-bound Bearer key, or a Clerk session
// whose active workspace is ALPHA. Team membership in BRAVO must not widen the
// credential: every team-scoped route answers 404 (no existence oracle), leaks
// none of BRAVO's data and mutates nothing.

/** BRAVO's team row + task→sprint bindings, on top of `snapshotProtected`. */
async function snapshotDualProtected() {
  const db = harness.prisma!
  const [base, bravoTeam, bravoTaskSprints] = await Promise.all([
    snapshotProtected(),
    db.team.findUnique({ where: { id: B().teamId } }),
    db.task.findMany({
      where: { teamId: B().teamId },
      select: { id: true, sprintId: true },
      orderBy: { id: 'asc' },
    }),
  ])
  return { ...base, bravoTeam, bravoTaskSprints }
}

type DualRun = (as: {
  caller: Caller
  source: AuthSource
}) => Promise<{ status: number; text: string }>

const sprintParams = () => ({ sprintId: B().sprintId })
const teamParams = () => ({ teamId: B().teamId })

/**
 * Ordered so a RED (unfixed) run's writes can't turn later reads into a
 * vacuous 404: reads first, the sprint DELETE last.
 */
const DUAL_ROUTES: Array<[string, DualRun]> = [
  [
    'GET /api/sprints/[sprintId]',
    as => call(sprintRoute.GET, 'GET', '/x', sprintParams(), as),
  ],
  [
    'GET /api/teams/[teamId]/tasks',
    as => call(teamTasksRoute.GET, 'GET', '/x', teamParams(), as),
  ],
  [
    'GET /api/teams/[teamId]/sprints',
    as => call(teamSprintsRoute.GET, 'GET', '/x', teamParams(), as),
  ],
  [
    'GET /api/sprints/[sprintId]/burnup',
    as => call(sprintBurnupRoute.GET, 'GET', '/x', sprintParams(), as),
  ],
  [
    'GET /api/sprints/[sprintId]/team-performance',
    as => call(sprintTeamPerfRoute.GET, 'GET', '/x', sprintParams(), as),
  ],
  [
    'GET /api/sprints/[sprintId]/tasks',
    as => call(sprintTasksRoute.GET, 'GET', '/x', sprintParams(), as),
  ],
  [
    'GET /api/sprints/[sprintId]/summary',
    as => call(sprintSummaryRoute.GET, 'GET', '/x', sprintParams(), as),
  ],
  [
    'PATCH /api/sprints/[sprintId]',
    as =>
      call(sprintRoute.PATCH, 'PATCH', '/x', sprintParams(), as, {
        name: 'pwned by dual member',
      }),
  ],
  [
    'POST /api/sprints/[sprintId]/tasks',
    as =>
      call(sprintTasksRoute.POST, 'POST', '/x', sprintParams(), as, {
        taskId: B().taskId,
      }),
  ],
  [
    'DELETE /api/sprints/[sprintId]/tasks/[taskId]',
    as =>
      call(
        sprintTaskRoute.DELETE,
        'DELETE',
        '/x',
        {
          sprintId: B().sprintId,
          taskId: fx.dualProbes![as.source].sprintTaskId,
        },
        as
      ),
  ],
  [
    'POST /api/sprints/[sprintId]/summary/retry',
    as => call(sprintSummaryRetryRoute.POST, 'POST', '/x', sprintParams(), as),
  ],
  [
    'POST /api/sprints/[sprintId]/start',
    as => call(sprintStartRoute.POST, 'POST', '/x', sprintParams(), as),
  ],
  [
    'POST /api/sprints/[sprintId]/close',
    as =>
      call(sprintCloseRoute.POST, 'POST', '/x', sprintParams(), as, {
        decisions: {},
      }),
  ],
  [
    'PATCH /api/teams/[teamId]/cadence',
    as =>
      call(teamCadenceRoute.PATCH, 'PATCH', '/x', teamParams(), as, {
        enabled: true,
        durationDays: 7,
      }),
  ],
  [
    'POST /api/teams/[teamId]/sprints',
    as =>
      call(teamSprintsRoute.POST, 'POST', '/x', teamParams(), as, {
        name: 'pwned by dual member',
        startDate: '2031-01-06T00:00:00.000Z',
        endDate: '2031-01-20T00:00:00.000Z',
      }),
  ],
  [
    'DELETE /api/sprints/[sprintId]',
    as =>
      call(
        sprintRoute.DELETE,
        'DELETE',
        '/x',
        { sprintId: fx.dualProbes![as.source].deleteSprintId },
        as
      ),
  ],
]

// Route-major order: each route runs for both sources before the next route.
const DUAL_CASES = DUAL_ROUTES.flatMap(([route, run]) =>
  BOTH.map(
    source =>
      [
        `dual member × ${source} (ALPHA-scoped) — ${route}`,
        source,
        run,
      ] as const
  )
)

describe('LUM-985 credential scope: a dual-member caller scoped to ALPHA cannot reach BRAVO team-scoped routes', () => {
  it('precondition: the dual member’s Clerk session resolves to ALPHA', async () => {
    const ws = await getUserWorkspace(DUAL_CLERK)
    expect(ws?.workspaceId).toBe(A().workspaceId)
  })

  it('control: the dual member’s BRAVO-bound key reaches BRAVO (membership is real)', async () => {
    const as = { caller: 'dualBravo' as const, source: 'bearer' as const }
    for (const res of [
      await call(sprintRoute.GET, 'GET', '/x', sprintParams(), as),
      await call(teamTasksRoute.GET, 'GET', '/x', teamParams(), as),
      await call(teamSprintsRoute.GET, 'GET', '/x', teamParams(), as),
    ]) {
      expect(res.status).toBe(200)
      expect(res.text).toContain(BRAVO_MARK)
    }
  })

  it.each(BOTH)(
    'control: the ALPHA-scoped dual member (%s) still reaches ALPHA’s own team routes',
    async source => {
      const as = { caller: 'dualAlpha' as const, source }
      const sprint = await call(
        sprintRoute.GET,
        'GET',
        '/x',
        { sprintId: A().sprintId },
        as
      )
      expect(sprint.status).toBe(200)
      expect(sprint.text).toContain('alpha-own sprint')
      const tasks = await call(
        teamTasksRoute.GET,
        'GET',
        '/x',
        { teamId: A().teamId },
        as
      )
      expect(tasks.status).toBe(200)
      expect(tasks.text).toContain('alpha-own task one')
    }
  )

  it.each(DUAL_CASES)('%s → 404', async (name, source, run) => {
    const before = await snapshotDualProtected()
    const res = await run({ caller: 'dualAlpha', source })
    // The received value names the real status on failure.
    expect(`${name} → ${res.status}`).toBe(`${name} → 404`)
    expect(res.text).not.toContain(BRAVO_MARK)
    expect(await snapshotDualProtected()).toEqual(before)
  })

  it('by-number with BRAVO’s slug is denied for the ALPHA-bound key', async () => {
    const res = await call(
      sprintByNumberRoute.GET,
      'GET',
      '/api/sprints/by-number?workspaceUrl=idor-bravo&number=1',
      {},
      { caller: 'dualAlpha', source: 'bearer' }
    )
    expect(res.status === 403 || res.status === 404).toBe(true)
    expect(res.text).not.toContain(BRAVO_MARK)
  })
})

// ── LUM-986: credential workspace scope on project milestone routes ─────────
// Same dual member, same ALPHA-scoped credentials as LUM-985, on the routes
// that authorize through the project's workspace. The project lives in BRAVO
// (where the human IS a member), so only the credential's workspace scope may
// deny it — with the exact body a missing project gets, so a mismatch can't
// confirm the id exists elsewhere.

const PROJECT_NOT_FOUND = { error: 'Project not found' }

/** Every BRAVO milestone row (create/reorder would touch these). */
async function snapshotMilestoneProtected() {
  const db = harness.prisma!
  const [base, bravoMilestones] = await Promise.all([
    snapshotDualProtected(),
    db.milestone.findMany({
      where: { projectId: B().projectId },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        sortOrder: true,
        archivedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
  ])
  return { ...base, bravoMilestones }
}

const projectParams = () => ({ id: B().projectId })

/** Reads first, then writes, so a RED run's writes can't skew later cases. */
const MILESTONE_ROUTES: Array<[string, DualRun]> = [
  [
    'GET /api/projects/[id]/milestones',
    as => call(projectMilestonesRoute.GET, 'GET', '/x', projectParams(), as),
  ],
  [
    'GET /api/projects/[id]/milestones/by-slug/[slug]',
    as =>
      call(
        projectMilestoneBySlugRoute.GET,
        'GET',
        '/x',
        { id: B().projectId, slug: 'bravo-milestone' },
        as
      ),
  ],
  [
    'PATCH /api/projects/[id]/milestones/reorder',
    as =>
      call(
        projectMilestonesReorderRoute.PATCH,
        'PATCH',
        '/x',
        projectParams(),
        as,
        { orderedIds: [B().milestoneId] }
      ),
  ],
  [
    'POST /api/projects/[id]/milestones',
    as =>
      call(projectMilestonesRoute.POST, 'POST', '/x', projectParams(), as, {
        name: 'pwned by dual member',
      }),
  ],
]

const MILESTONE_CASES = MILESTONE_ROUTES.flatMap(([route, run]) =>
  BOTH.map(
    source =>
      [
        `dual member × ${source} (ALPHA-scoped) — ${route}`,
        source,
        run,
      ] as const
  )
)

describe('LUM-986 credential scope: a dual-member caller scoped to ALPHA cannot reach BRAVO project milestone routes', () => {
  it('control: the dual member’s BRAVO-bound key reaches BRAVO’s milestones (membership is real)', async () => {
    const as = { caller: 'dualBravo' as const, source: 'bearer' as const }
    for (const res of [
      await call(projectMilestonesRoute.GET, 'GET', '/x', projectParams(), as),
      await call(
        projectMilestoneBySlugRoute.GET,
        'GET',
        '/x',
        { id: B().projectId, slug: 'bravo-milestone' },
        as
      ),
    ]) {
      expect(res.status).toBe(200)
      expect(res.text).toContain(`${BRAVO_MARK} milestone`)
    }
  })

  it.each(BOTH)(
    'control: the ALPHA-scoped dual member (%s) still reaches ALPHA’s own milestone routes',
    async source => {
      const as = { caller: 'dualAlpha' as const, source }
      const list = await call(
        projectMilestonesRoute.GET,
        'GET',
        '/x',
        { id: A().projectId },
        as
      )
      expect(list.status).toBe(200)
      expect(list.text).toContain('alpha-own milestone')
      const bySlug = await call(
        projectMilestoneBySlugRoute.GET,
        'GET',
        '/x',
        { id: A().projectId, slug: 'alpha-milestone' },
        as
      )
      expect(bySlug.status).toBe(200)
      expect(bySlug.text).toContain('alpha-own milestone')
      const reorder = await call(
        projectMilestonesReorderRoute.PATCH,
        'PATCH',
        '/x',
        { id: A().projectId },
        as,
        { orderedIds: [A().milestoneId] }
      )
      expect(reorder.status).toBe(200)
    }
  )

  it('precondition: a missing project answers the body the mismatch must match', async () => {
    const res = await call(
      projectMilestonesRoute.GET,
      'GET',
      '/x',
      { id: 'cmissingprojectidor0000000' },
      { caller: 'dualAlpha', source: 'bearer' }
    )
    expect(res.status).toBe(404)
    expect(JSON.parse(res.text)).toEqual(PROJECT_NOT_FOUND)
  })

  it.each(MILESTONE_CASES)('%s → 404', async (name, source, run) => {
    const before = await snapshotMilestoneProtected()
    const res = await run({ caller: 'dualAlpha', source })
    // The received value names the real status on failure.
    expect(`${name} → ${res.status}`).toBe(`${name} → 404`)
    expect(res.text).not.toContain(BRAVO_MARK)
    expect(JSON.parse(res.text)).toEqual(PROJECT_NOT_FOUND)
    expect(await snapshotMilestoneProtected()).toEqual(before)
  })
})

// ── LUM-987: a Clerk session's active workspace is the URL slug ─────────────
// The browser's apiFetch sends the `/workspace/<slug>/…` slug as
// `X-Lumo-Workspace`. The dual member (a real member of BOTH workspaces) with
// active slug ALPHA must be denied BRAVO's resources on the resource-by-id
// routes that authorize through the resource's workspace — with 404, nothing
// of BRAVO in the body, BRAVO's rows unchanged. With active slug BRAVO the
// same human reaches BRAVO. No slug → a pinned, deterministic default.

const SLUG = { alpha: 'idor-alpha', bravo: 'idor-bravo' } as const

const p987: { projectId: string; taskId: string; sessionId: string } = {
  projectId: '',
  taskId: '',
  sessionId: '',
}

async function seedActiveWorkspaceProbes() {
  const db = harness.prisma!
  const dualBravo = await db.workspaceMember.findUniqueOrThrow({
    where: {
      workspaceId_clerkId: {
        workspaceId: B().workspaceId,
        clerkId: DUAL_CLERK,
      },
    },
  })
  // Created by the dual member, so on an unfixed run nothing but the active
  // workspace could stop the DELETE.
  const project = await db.project.create({
    data: {
      workspaceId: B().workspaceId,
      teamId: B().teamId,
      createdByMemberId: dualBravo.id,
      name: `${BRAVO_MARK} lum987 probe project`,
    },
  })
  const task = await db.task.create({
    data: {
      projectId: B().projectId,
      teamId: B().teamId,
      number: 987,
      title: `${BRAVO_MARK} lum987 probe task`,
    },
  })
  const session = await db.session.create({
    data: {
      id: 'idor-lum987-bravo-session',
      workspaceId: B().workspaceId,
      workspaceMemberId: dualBravo.id,
      cwd: `/tmp/${BRAVO_MARK}`,
      lastActivityAt: new Date('2030-01-07T00:00:00.000Z'),
    },
  })
  p987.projectId = project.id
  p987.taskId = task.id
  p987.sessionId = session.id
}

async function snapshot987() {
  const db = harness.prisma!
  const [base, project, task, session, bravoProjectTasks] = await Promise.all([
    snapshotDualProtected(),
    db.project.findUnique({ where: { id: p987.projectId } }),
    db.task.findUnique({ where: { id: p987.taskId } }),
    db.session.findUnique({ where: { id: p987.sessionId } }),
    db.task.findMany({
      where: { projectId: B().projectId },
      select: { id: true, title: true, deletedAt: true },
      orderBy: { id: 'asc' },
    }),
  ])
  return { ...base, project, task, session, bravoProjectTasks }
}

type Run987 = (as: {
  caller: Caller
  source: AuthSource
  activeSlug?: string
}) => Promise<{ status: number; text: string }>

/** Resource-by-id routes reading a resource of workspace `w`. */
const read987 = (w: () => WorkspaceFixture): Array<[string, Run987]> => [
  [
    'GET /api/tasks/[id]',
    as => call(taskRoute.GET, 'GET', '/x', { id: w().taskId }, as),
  ],
  [
    'GET /api/tasks/[id]/web-links',
    as => call(taskWebLinksRoute.GET, 'GET', '/x', { id: w().taskId }, as),
  ],
  [
    'GET /api/tasks/[id]/progress',
    as => call(taskProgressRoute.GET, 'GET', '/x', { id: w().taskId }, as),
  ],
  [
    'GET /api/projects/[id]',
    as => call(projectRoute.GET, 'GET', '/x', { id: w().projectId }, as),
  ],
  [
    'GET /api/projects/[id]/tasks',
    as =>
      call(
        projectTasksRoute.GET,
        'GET',
        `/api/projects/${w().projectId}/tasks`,
        { id: w().projectId },
        as
      ),
  ],
]

/** Reads first, then writes; the destructive cases hit dedicated probes. */
const DENIED_987: Array<[string, Run987]> = [
  ...read987(B),
  [
    'GET /api/sessions/[sessionId]/raw-record',
    as =>
      call(
        sessionRawRecordRoute.GET,
        'GET',
        '/x',
        { sessionId: p987.sessionId },
        as
      ),
  ],
  [
    'PATCH /api/tasks/[id]',
    as =>
      call(taskRoute.PATCH, 'PATCH', '/x', { id: p987.taskId }, as, {
        title: 'pwned by the alpha-active session',
      }),
  ],
  [
    'POST /api/projects/[id]/tasks',
    as =>
      call(projectTasksRoute.POST, 'POST', '/x', { id: B().projectId }, as, {
        title: 'pwned by the alpha-active session',
      }),
  ],
  [
    'DELETE /api/tasks/[id]',
    as => call(taskRoute.DELETE, 'DELETE', '/x', { id: p987.taskId }, as),
  ],
  [
    'DELETE /api/projects/[id]',
    as => call(projectRoute.DELETE, 'DELETE', '/x', { id: p987.projectId }, as),
  ],
]

describe('LUM-987 Clerk active workspace: the dual member’s session is scoped to the URL slug', () => {
  beforeAll(async () => {
    await seedActiveWorkspaceProbes()
  })

  it('determinism: with no slug the session resolves to the oldest membership, not the first row stored', async () => {
    const db = harness.prisma!
    // A fresh human whose BRAVO row is stored FIRST but joined LATER, so an
    // unordered findFirst (heap / index order) returns BRAVO while the pinned
    // order (joinedAt, then id) returns ALPHA.
    const clerkId = 'user_idor_lum987_order_probe'
    await db.workspaceMember.create({
      data: {
        workspaceId: B().workspaceId,
        clerkId,
        joinedAt: new Date('2030-02-01T00:00:00.000Z'),
      },
    })
    await db.workspaceMember.create({
      data: {
        workspaceId: A().workspaceId,
        clerkId,
        joinedAt: new Date('2030-01-01T00:00:00.000Z'),
      },
    })
    for (let i = 0; i < 3; i++) {
      const ws = await getUserWorkspace(clerkId)
      expect(ws?.workspaceId).toBe(A().workspaceId)
    }
    // The fixture dual member (ALPHA joined first) lands on ALPHA too.
    expect((await getUserWorkspace(DUAL_CLERK))?.workspaceId).toBe(
      A().workspaceId
    )
  })

  it.each(DENIED_987)(
    'dual member × clerk, active slug ALPHA — %s on BRAVO → 404',
    async (name, run) => {
      const before = await snapshot987()
      const res = await run({
        caller: 'dualAlpha',
        source: 'clerk',
        activeSlug: SLUG.alpha,
      })
      expect(`${name} → ${res.status}`).toBe(`${name} → 404`)
      expect(res.text).not.toContain(BRAVO_MARK)
      expect(await snapshot987()).toEqual(before)
    }
  )

  it.each(read987(B))(
    'control: active slug BRAVO — %s reaches BRAVO',
    async (name, run) => {
      const res = await run({
        caller: 'dualBravo',
        source: 'clerk',
        activeSlug: SLUG.bravo,
      })
      expect(`${name} → ${res.status}`).toBe(`${name} → 200`)
    }
  )

  it.each(read987(A))(
    'control: active slug ALPHA — %s reaches ALPHA',
    async (name, run) => {
      const res = await run({
        caller: 'dualAlpha',
        source: 'clerk',
        activeSlug: SLUG.alpha,
      })
      expect(`${name} → ${res.status}`).toBe(`${name} → 200`)
    }
  )

  it('control: active slug BRAVO — the session raw-record reaches BRAVO’s session', async () => {
    const res = await call(
      sessionRawRecordRoute.GET,
      'GET',
      '/x',
      { sessionId: p987.sessionId },
      { caller: 'dualBravo', source: 'clerk', activeSlug: SLUG.bravo }
    )
    expect(res.status).toBe(200)
  })

  it('control: active slug BRAVO — the task detail carries BRAVO’s data', async () => {
    const res = await call(
      taskRoute.GET,
      'GET',
      '/x',
      { id: B().taskId },
      { caller: 'dualBravo', source: 'clerk', activeSlug: SLUG.bravo }
    )
    expect(res.status).toBe(200)
    expect(res.text).toContain(`${BRAVO_MARK} task one`)
  })

  it.each([SLUG.alpha, SLUG.bravo])(
    'requireWorkspaceByUrl: the dual member is not 403’d on their own workspace %s',
    async slug => {
      const res = await call(
        draftsRoute.GET,
        'GET',
        `/api/drafts?workspaceUrl=${slug}`,
        {},
        { caller: 'dualAlpha', source: 'clerk', activeSlug: slug }
      )
      expect(`${slug} → ${res.status}`).toBe(`${slug} → 200`)
    }
  )

  it('requireIdentity: active slug BRAVO resolves the Clerk identity to BRAVO; ALPHA keeps BRAVO out', async () => {
    const bravo = await call(sprintRoute.GET, 'GET', '/x', sprintParams(), {
      caller: 'dualBravo',
      source: 'clerk',
      activeSlug: SLUG.bravo,
    })
    expect(bravo.status).toBe(200)
    expect(bravo.text).toContain(`${BRAVO_MARK} sprint`)
    const alpha = await call(sprintRoute.GET, 'GET', '/x', sprintParams(), {
      caller: 'dualAlpha',
      source: 'clerk',
      activeSlug: SLUG.alpha,
    })
    expect(alpha.status).toBe(404)
    expect(alpha.text).not.toContain(BRAVO_MARK)
  })

  it('a slug the dual member does not belong to is refused (no silent fallback)', async () => {
    const identityRoute = await call(
      sprintRoute.GET,
      'GET',
      '/x',
      { sprintId: A().sprintId },
      { caller: 'dualAlpha', source: 'clerk', activeSlug: 'idor-nowhere' }
    )
    expect(identityRoute.status).toBe(403)
    const resourceRoute = await call(
      taskRoute.GET,
      'GET',
      '/x',
      { id: A().taskId },
      { caller: 'dualAlpha', source: 'clerk', activeSlug: 'idor-nowhere' }
    )
    expect(resourceRoute.status).toBe(404)
  })

  it('Bearer: the slug header cannot move an ALPHA-bound key to BRAVO', async () => {
    const res = await call(sprintRoute.GET, 'GET', '/x', sprintParams(), {
      caller: 'dualAlpha',
      source: 'bearer',
      activeSlug: SLUG.bravo,
    })
    expect(res.status).toBe(404)
    expect(res.text).not.toContain(BRAVO_MARK)
    const own = await call(
      sprintRoute.GET,
      'GET',
      '/x',
      { sprintId: A().sprintId },
      { caller: 'dualAlpha', source: 'bearer', activeSlug: SLUG.bravo }
    )
    expect(own.status).toBe(200)
  })

  it('single-workspace user: a slug header changes nothing (own workspace 200, BRAVO still 403)', async () => {
    const own = await call(
      taskRoute.GET,
      'GET',
      '/x',
      { id: A().taskId },
      { caller: 'alphaOwner', source: 'clerk', activeSlug: SLUG.bravo }
    )
    expect(own.status).toBe(200)
    const identity = await call(
      sprintRoute.GET,
      'GET',
      '/x',
      { sprintId: A().sprintId },
      { caller: 'alphaOwner', source: 'clerk', activeSlug: SLUG.bravo }
    )
    expect(identity.status).toBe(200)
    const other = await call(
      taskRoute.GET,
      'GET',
      '/x',
      { id: B().taskId },
      { caller: 'alphaOwner', source: 'clerk', activeSlug: SLUG.alpha }
    )
    expect(other.status).toBe(403)
  })
})

// ── LUM-990: document move — the target parent must be the caller's ────────
// `PATCH /api/documents/[id]/move` authorized only the document being moved;
// the body's `parentId` was only walked for cycle detection (which, scoped by
// LUM-979, just stops early on a foreign id) and then written as-is. The rule
// applied now: the target parent must be a document the caller may EDIT in
// their own workspace (owner, WORKSPACE visibility, or EDITOR/MANAGER share —
// `findEditable`), else the same generic 404 as a missing document.

describe('LUM-990 document move: the target parent must be editable in the caller’s workspace', () => {
  let docNumber = 900
  const ids: {
    alphaMemberId: string
    alphaParent: string
    alphaParent2: string
    privateParent: string
    viewerParent: string
    editorParent: string
  } = {
    alphaMemberId: '',
    alphaParent: '',
    alphaParent2: '',
    privateParent: '',
    viewerParent: '',
    editorParent: '',
  }

  async function makeDoc(
    workspaceId: string,
    createdById: string,
    label: string,
    visibility: 'PRIVATE' | 'SHARED' | 'WORKSPACE' = 'WORKSPACE',
    parentId: string | null = null
  ) {
    const n = docNumber++
    const doc = await harness.prisma!.document.create({
      data: {
        workspaceId,
        createdById,
        number: n,
        slug: `lum990-${label}-${n}`,
        title: `lum990 ${label}`,
        visibility,
        parentId,
      },
    })
    return doc.id
  }

  /** BRAVO's whole document tree, plus every row pointing into it. */
  async function bravoTree() {
    const db = harness.prisma!
    const own = await db.document.findMany({
      where: { workspaceId: B().workspaceId },
      select: { id: true, parentId: true, sortOrder: true, title: true },
      orderBy: { id: 'asc' },
    })
    const pointingIn = await db.document.findMany({
      where: { parentId: { in: own.map(d => d.id) } },
      select: { id: true, workspaceId: true, parentId: true },
      orderBy: { id: 'asc' },
    })
    return { own, pointingIn }
  }

  async function parentOf(id: string) {
    const row = await harness.prisma!.document.findUnique({
      where: { id },
      select: { parentId: true, sortOrder: true },
    })
    return row
  }

  const move = (
    docId: string,
    body: { parentId: string | null; sortOrder: number },
    as: { caller: Caller; source: AuthSource }
  ) =>
    call(
      documentMoveRoute.PATCH,
      'PATCH',
      `/api/documents/${docId}/move`,
      { id: docId },
      as,
      body
    )

  beforeAll(async () => {
    const db = harness.prisma!
    const member = await db.workspaceMember.findFirstOrThrow({
      where: { workspaceId: A().workspaceId, clerkId: CLERK.alphaMember },
      select: { id: true },
    })
    ids.alphaMemberId = member.id
    const owner = A().ownerMemberId
    ids.alphaParent = await makeDoc(A().workspaceId, owner, 'alpha-parent')
    ids.alphaParent2 = await makeDoc(A().workspaceId, owner, 'alpha-parent-2')
    // Same-workspace parents the plain ALPHA member can NOT edit:
    ids.privateParent = await makeDoc(
      A().workspaceId,
      owner,
      'alpha-private-parent',
      'PRIVATE'
    )
    ids.viewerParent = await makeDoc(
      A().workspaceId,
      owner,
      'alpha-viewer-parent',
      'SHARED'
    )
    await db.documentShare.create({
      data: {
        documentId: ids.viewerParent,
        memberId: member.id,
        role: 'VIEWER',
      },
    })
    // ...and one they can (EDITOR share on a SHARED doc).
    ids.editorParent = await makeDoc(
      A().workspaceId,
      owner,
      'alpha-editor-parent',
      'SHARED'
    )
    await db.documentShare.create({
      data: {
        documentId: ids.editorParent,
        memberId: member.id,
        role: 'EDITOR',
      },
    })
  })

  it.each(BOTH)(
    'cross-tenant × %s: ALPHA moving its own doc under BRAVO’s doc → 404, nothing written',
    async source => {
      const docId = await makeDoc(
        A().workspaceId,
        A().ownerMemberId,
        `alpha-mover-${source}`,
        'WORKSPACE',
        ids.alphaParent
      )
      const before = await parentOf(docId)
      const treeBefore = await bravoTree()
      const snapBefore = await snapshotProtected()

      const res = await move(
        docId,
        { parentId: B().documentId, sortOrder: 7 },
        { caller: 'alphaOwner', source }
      )

      expect(`${source} move → ${res.status}`).toBe(`${source} move → 404`)
      // Generic: nothing distinguishes "foreign parent" from "missing doc".
      expect(JSON.parse(res.text)).toEqual({
        error: 'Not found or no permission',
      })
      expect(res.text).not.toContain(B().documentId)
      expect(res.text).not.toContain(BRAVO_MARK)
      expect(await parentOf(docId)).toEqual(before)
      expect(await bravoTree()).toEqual(treeBefore)
      expect(await snapshotProtected()).toEqual(snapBefore)
    }
  )

  it.each(BOTH)(
    'listing leak × %s: after the attempt, BRAVO’s own view of its doc lists no ALPHA child',
    async source => {
      const docId = await makeDoc(
        A().workspaceId,
        A().ownerMemberId,
        `alpha-leak-probe-${source}`
      )
      await move(
        docId,
        { parentId: B().documentId, sortOrder: 1 },
        { caller: 'alphaOwner', source }
      )
      const bravoView = await call(
        documentRoute.GET,
        'GET',
        '/x',
        { id: B().documentId },
        { caller: 'bravoOwner', source: 'bearer' }
      )
      expect(bravoView.status).toBe(200)
      expect(bravoView.text).toContain(BRAVO_MARK)
      expect(bravoView.text).not.toContain(docId)
      expect(bravoView.text).not.toContain(`alpha-leak-probe-${source}`)
    }
  )

  it.each(BOTH)(
    'same workspace × %s: moving under a parent the caller can only view (or not see) → 404',
    async source => {
      for (const parentId of [ids.privateParent, ids.viewerParent]) {
        const docId = await makeDoc(
          A().workspaceId,
          ids.alphaMemberId,
          `member-mover-${source}`
        )
        const res = await move(
          docId,
          { parentId, sortOrder: 3 },
          { caller: 'alphaMember', source }
        )
        expect(`${parentId} → ${res.status}`).toBe(`${parentId} → 404`)
        expect(JSON.parse(res.text)).toEqual({
          error: 'Not found or no permission',
        })
        expect(await parentOf(docId)).toEqual({ parentId: null, sortOrder: 0 })
      }
    }
  )

  it.each(BOTH)(
    'control × %s: moving within ALPHA to an editable parent, then to root → 200',
    async source => {
      const docId = await makeDoc(
        A().workspaceId,
        A().ownerMemberId,
        `alpha-control-${source}`,
        'WORKSPACE',
        ids.alphaParent
      )
      const toParent = await move(
        docId,
        { parentId: ids.alphaParent2, sortOrder: 5 },
        { caller: 'alphaOwner', source }
      )
      expect(toParent.status).toBe(200)
      expect(await parentOf(docId)).toEqual({
        parentId: ids.alphaParent2,
        sortOrder: 5,
      })

      const toRoot = await move(
        docId,
        { parentId: null, sortOrder: 2 },
        { caller: 'alphaOwner', source }
      )
      expect(toRoot.status).toBe(200)
      expect(await parentOf(docId)).toEqual({ parentId: null, sortOrder: 2 })
    }
  )

  it.each(BOTH)(
    'control × %s: a plain member may move under a doc shared to them as EDITOR → 200',
    async source => {
      const docId = await makeDoc(
        A().workspaceId,
        ids.alphaMemberId,
        `member-editor-${source}`
      )
      const res = await move(
        docId,
        { parentId: ids.editorParent, sortOrder: 4 },
        { caller: 'alphaMember', source }
      )
      expect(res.status).toBe(200)
      expect(await parentOf(docId)).toEqual({
        parentId: ids.editorParent,
        sortOrder: 4,
      })
    }
  )

  it('malformed JSON body → 400, not a 500', async () => {
    clerkSession.userId = CLERK.alphaOwner
    const request = new NextRequest(
      `http://localhost/api/documents/${ids.alphaParent}/move`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }
    )
    inflight.headers = request.headers
    const res = await documentMoveRoute.PATCH(request, {
      params: Promise.resolve({ id: ids.alphaParent }),
    })
    expect(res.status).toBe(400)
  })

  it.each(BOTH)(
    'cycle detection kept × %s: moving a doc under its own child → 400',
    async source => {
      const top = await makeDoc(
        A().workspaceId,
        A().ownerMemberId,
        `cycle-top-${source}`
      )
      const child = await makeDoc(
        A().workspaceId,
        A().ownerMemberId,
        `cycle-child-${source}`,
        'WORKSPACE',
        top
      )
      const res = await move(
        top,
        { parentId: child, sortOrder: 0 },
        { caller: 'alphaOwner', source }
      )
      expect(res.status).toBe(400)
      expect(await parentOf(top)).toEqual({ parentId: null, sortOrder: 0 })
    }
  )
})

// ── LUM-993: document create — parent and project must be the caller's ─────
// `POST /api/documents` passed the body's `parentId` / `projectId` straight
// to `documentService.createDocument`, which wrote them unchecked: an ALPHA
// caller could hang a document under a BRAVO document (or file it in a BRAVO
// project), and BRAVO's own child listings then surfaced it, because every
// `children` include / `_count.children` filtered only `deletedAt`. The rules
// now: the parent must pass the same `findEditable` check LUM-990 applies to a
// move target, the project must be in the caller's workspace (either → generic
// 404, nothing written), and every child listing is scoped by `workspaceId`.

describe('LUM-993 document create: parent and project must be the caller’s', () => {
  let docNumber = 9300
  const ids: { alphaMemberId: string; privateParent: string } = {
    alphaMemberId: '',
    privateParent: '',
  }

  async function makeDoc(
    workspaceId: string,
    createdById: string,
    label: string,
    visibility: 'PRIVATE' | 'SHARED' | 'WORKSPACE' = 'WORKSPACE',
    parentId: string | null = null
  ) {
    const n = docNumber++
    const doc = await harness.prisma!.document.create({
      data: {
        workspaceId,
        createdById,
        number: n,
        slug: `lum993-${label}-${n}`,
        title: `lum993 ${label}`,
        visibility,
        parentId,
      },
    })
    return doc.id
  }

  const create = (
    body: Record<string, unknown>,
    as: { caller: Caller; source: AuthSource }
  ) => call(documentsRoute.POST, 'POST', '/api/documents', {}, as, body)

  /** Every row (any workspace) with this title — i.e. what a create wrote. */
  const rowsTitled = (title: string) =>
    harness.prisma!.document.findMany({
      where: { title },
      select: { id: true, workspaceId: true, parentId: true, projectId: true },
    })

  /** Every document row pointing into BRAVO (as child or by project). */
  async function bravoInbound() {
    const db = harness.prisma!
    const own = await db.document.findMany({
      where: { workspaceId: B().workspaceId },
      select: { id: true },
    })
    return db.document.findMany({
      where: {
        OR: [
          { parentId: { in: own.map(d => d.id) } },
          { projectId: B().projectId },
        ],
      },
      select: { id: true, workspaceId: true, parentId: true, projectId: true },
      orderBy: { id: 'asc' },
    })
  }

  beforeAll(async () => {
    // Fixture documents were seeded with hand-picked numbers; move each
    // workspace's counter past them so API creates get a free number.
    await harness.prisma!.workspace.updateMany({
      where: { id: { in: [A().workspaceId, B().workspaceId] } },
      data: { documentSeq: 20_000 },
    })
    const member = await harness.prisma!.workspaceMember.findFirstOrThrow({
      where: { workspaceId: A().workspaceId, clerkId: CLERK.alphaMember },
      select: { id: true },
    })
    ids.alphaMemberId = member.id
    ids.privateParent = await makeDoc(
      A().workspaceId,
      A().ownerMemberId,
      'alpha-private-parent',
      'PRIVATE'
    )
  })

  it.each(BOTH)(
    'cross-tenant × %s: ALPHA creating under BRAVO’s doc → 404, nothing written',
    async source => {
      for (const parentId of [B().documentId]) {
        const title = `lum993 under-bravo ${source} ${parentId}`
        const inboundBefore = await bravoInbound()
        const snapBefore = await snapshotProtected()

        const res = await create(
          { title, visibility: 'WORKSPACE', parentId },
          { caller: 'alphaOwner', source }
        )

        expect(`${parentId} → ${res.status}`).toBe(`${parentId} → 404`)
        expect(JSON.parse(res.text)).toEqual({
          error: 'Not found or no permission',
        })
        expect(res.text).not.toContain(B().documentId)
        expect(res.text).not.toContain(BRAVO_MARK)
        expect(await rowsTitled(title)).toEqual([])
        expect(await bravoInbound()).toEqual(inboundBefore)
        expect(await snapshotProtected()).toEqual(snapBefore)
      }
    }
  )

  it.each(BOTH)(
    'cross-tenant × %s: ALPHA creating in BRAVO’s project → 404, nothing written',
    async source => {
      const title = `lum993 in-bravo-project ${source}`
      const inboundBefore = await bravoInbound()
      const snapBefore = await snapshotProtected()

      const res = await create(
        { title, visibility: 'WORKSPACE', projectId: B().projectId },
        { caller: 'alphaOwner', source }
      )

      expect(res.status).toBe(404)
      expect(res.text).not.toContain(B().projectId)
      expect(res.text).not.toContain(BRAVO_MARK)
      expect(await rowsTitled(title)).toEqual([])
      expect(await bravoInbound()).toEqual(inboundBefore)
      expect(await snapshotProtected()).toEqual(snapBefore)
    }
  )

  it.each(BOTH)(
    'same workspace × %s: a member creating under a parent they cannot edit → 404, nothing written',
    async source => {
      const title = `lum993 under-private ${source}`
      const res = await create(
        { title, visibility: 'WORKSPACE', parentId: ids.privateParent },
        { caller: 'alphaMember', source }
      )
      expect(res.status).toBe(404)
      expect(JSON.parse(res.text)).toEqual({
        error: 'Not found or no permission',
      })
      expect(await rowsTitled(title)).toEqual([])
    }
  )

  it.each(BOTH)(
    'control × %s: ALPHA creating at root, under its own doc, in its own project → 201',
    async source => {
      const root = await create(
        { title: `lum993 ctl-root ${source}`, visibility: 'WORKSPACE' },
        { caller: 'alphaOwner', source }
      )
      expect(root.status).toBe(201)
      expect(await rowsTitled(`lum993 ctl-root ${source}`)).toEqual([
        expect.objectContaining({
          workspaceId: A().workspaceId,
          parentId: null,
          projectId: null,
        }),
      ])

      for (const parentId of [A().documentId]) {
        const title = `lum993 ctl-parent ${source} ${parentId}`
        const res = await create(
          { title, visibility: 'WORKSPACE', parentId },
          { caller: 'alphaOwner', source }
        )
        expect(res.status).toBe(201)
        expect(await rowsTitled(title)).toEqual([
          expect.objectContaining({
            workspaceId: A().workspaceId,
            parentId: A().documentId,
          }),
        ])
      }

      const inProject = await create(
        {
          title: `lum993 ctl-project ${source}`,
          visibility: 'WORKSPACE',
          projectId: A().projectId,
        },
        { caller: 'alphaOwner', source }
      )
      expect(inProject.status).toBe(201)
      expect(await rowsTitled(`lum993 ctl-project ${source}`)).toEqual([
        expect.objectContaining({
          workspaceId: A().workspaceId,
          projectId: A().projectId,
        }),
      ])
    }
  )

  describe('child listings never surface another workspace’s rows', () => {
    const seeded: {
      bravoParent: string
      bravoChild: string
      alphaIntruder: string
    } = { bravoParent: '', bravoChild: '', alphaIntruder: '' }

    beforeAll(async () => {
      seeded.bravoParent = await makeDoc(
        B().workspaceId,
        B().ownerMemberId,
        'bravo-listing-parent'
      )
      seeded.bravoChild = await makeDoc(
        B().workspaceId,
        B().ownerMemberId,
        'bravo-listing-child',
        'WORKSPACE',
        seeded.bravoParent
      )
      // Bypass the API: an ALPHA row hung under BRAVO's doc, the shape a
      // pre-fix create (or move) could have left behind in the database.
      seeded.alphaIntruder = await makeDoc(
        A().workspaceId,
        A().ownerMemberId,
        'alpha-intruder',
        'WORKSPACE',
        seeded.bravoParent
      )
    })

    const asBravo = { caller: 'bravoOwner' as const, source: 'bearer' as const }

    it('BRAVO’s document detail: children and _count exclude the ALPHA row', async () => {
      const res = await call(
        documentRoute.GET,
        'GET',
        '/x',
        { id: seeded.bravoParent },
        asBravo
      )
      expect(res.status).toBe(200)
      const body = JSON.parse(res.text) as {
        document: {
          children: Array<{ id: string }>
          _count: { children: number }
        }
      }
      expect(body.document.children.map(c => c.id)).toEqual([seeded.bravoChild])
      expect(body.document._count.children).toBe(1)
      expect(res.text).not.toContain(seeded.alphaIntruder)
      expect(res.text).not.toContain('alpha-intruder')
    })

    it('BRAVO’s child detail: the ancestor’s sibling list excludes the ALPHA row', async () => {
      const res = await call(
        documentRoute.GET,
        'GET',
        '/x',
        { id: seeded.bravoChild },
        asBravo
      )
      expect(res.status).toBe(200)
      const body = JSON.parse(res.text) as {
        ancestors: Array<{ id: string; children: Array<{ id: string }> }>
      }
      const parent = body.ancestors.find(a => a.id === seeded.bravoParent)
      expect(parent?.children.map(c => c.id)).toEqual([seeded.bravoChild])
      expect(res.text).not.toContain(seeded.alphaIntruder)
    })

    it('BRAVO’s document list: the parent’s _count excludes the ALPHA row', async () => {
      const res = await call(
        documentsRoute.GET,
        'GET',
        '/api/documents',
        {},
        asBravo
      )
      expect(res.status).toBe(200)
      const body = JSON.parse(res.text) as {
        documents: Array<{ id: string; _count: { children: number } }>
      }
      const parent = body.documents.find(d => d.id === seeded.bravoParent)
      expect(parent?._count.children).toBe(1)
      expect(res.text).not.toContain(seeded.alphaIntruder)
    })

    it('BRAVO’s sidebar tree: childCount excludes the ALPHA row', async () => {
      const res = await call(
        documentTreeRoute.GET,
        'GET',
        '/api/documents/tree',
        {},
        { caller: 'bravoOwner', source: 'clerk' }
      )
      expect(res.status).toBe(200)
      const body = JSON.parse(res.text) as {
        roots: Array<{
          id: string
          childCount: number
          children?: Array<{ id: string }>
        }>
      }
      const parent = body.roots.find(r => r.id === seeded.bravoParent)
      expect(parent?.childCount).toBe(1)
      expect(parent?.children?.map(c => c.id)).toEqual([seeded.bravoChild])
      expect(res.text).not.toContain(seeded.alphaIntruder)
    })
  })
})
