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

import * as taskRoute from '@/app/api/tasks/[id]/route'
import * as taskByIdentifierRoute from '@/app/api/tasks/by-identifier/[identifier]/route'
import * as projectRoute from '@/app/api/projects/[id]/route'
import * as documentRoute from '@/app/api/documents/[id]/route'
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

jest.setTimeout(240_000)

// ── Fixture ──────────────────────────────────────────────────────────────────

/** Every BRAVO string carries this marker; it must never reach an ALPHA caller. */
const BRAVO_MARK = 'bravo-private'
/** ALPHA's second team, which the plain ALPHA member is NOT a TeamMember of. */
const RESTRICTED_MARK = 'alpha-restricted-team'

const CLERK = {
  alphaOwner: 'user_idor_alpha_owner',
  alphaMember: 'user_idor_alpha_member',
  bravoOwner: 'user_idor_bravo_owner',
}
/** Readable, non-secret-shaped fixture tokens (only their sha256 is stored). */
const TOKEN = {
  alphaOwner: 'idor-fixture-bearer-alpha-owner',
  alphaMember: 'idor-fixture-bearer-alpha-member',
  bravoOwner: 'idor-fixture-bearer-bravo-owner',
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

const fx: {
  alpha: WorkspaceFixture | null
  bravo: WorkspaceFixture | null
  restricted: { teamId: string; sprintId: string; taskId: string } | null
  alphaMemberTeamId: string | null
} = { alpha: null, bravo: null, restricted: null, alphaMemberTeamId: null }

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
})

afterAll(async () => {
  await harness.stop()
})

// ── Request plumbing ────────────────────────────────────────────────────────

type AuthSource = 'clerk' | 'bearer'
type Caller = 'alphaOwner' | 'alphaMember' | 'bravoOwner'
type Handler = (
  request: NextRequest,
  context: { params: Promise<Record<string, string>> }
) => Promise<Response>

async function call(
  handler: unknown,
  method: string,
  path: string,
  params: Record<string, string>,
  as: { caller: Caller; source: AuthSource },
  body?: unknown
): Promise<{ status: number; text: string }> {
  clerkSession.userId = as.source === 'clerk' ? CLERK[as.caller] : null
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (as.source === 'bearer')
    headers.authorization = `Bearer ${TOKEN[as.caller]}`
  const request = new NextRequest(`http://localhost${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
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
