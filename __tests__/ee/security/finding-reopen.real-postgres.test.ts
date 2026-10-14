/**
 * @jest-environment node
 *
 * LUM-1128 follow-up — reverting a security-finding ruling, end to end against
 * a REAL Postgres (every migration replayed into PGlite): real Bearer lookup,
 * real route handler, service, repositories, transaction, activity + audit
 * writes, the DONE gate and the cross-push inheritance read.
 *
 * Covers: a mistaken ruling can be reopened from the web panel (Clerk) —
 * the DONE block comes back exactly as before, the timeline/audit say
 * WEB from → OPEN — but never from the CLI (bearer → 403); a reopened finding
 * is NOT re-cleared by inheritance from an older ruled row of the same
 * fingerprint; and a ruling whose timeline insert fails rolls back (atomic).
 */
import { createHash } from 'crypto'
import { NextRequest } from 'next/server'
import { createPgliteHarness } from '../../../scripts/test-support/pglite-harness'
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

import * as dispositionRoute from '@/app/api/tasks/[id]/security-findings/[findingId]/disposition/route'
import * as findingsRoute from '@/app/api/tasks/[id]/security-findings/route'
import { assertNoOpenBlockingSecurityFindings } from '@/ee/security/services/pr-security-scan-gate'
import { prSecurityScanRepository } from '@/ee/security/repositories/pr-security-scan.repository'
import { inheritDispositions } from '@/ee/security/security-scan/inherit-dispositions'
import { activityRepository } from '@/lib/repositories/activity.repository'

jest.setTimeout(240_000)

/** Readable, non-secret-shaped fixture token (only its sha256 is stored). */
const bearerFixture = 'reopen-fixture-bearer-alpha'
const CLERK = 'user_reopen_alpha'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
const FP = 'fp-reopen'

const fx = {
  workspaceId: '',
  memberId: '',
  taskId: '',
  pullRequestId: '',
  oldFindingId: '',
  findingId: '',
}

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  const db = harness.prisma!
  const ws = await db.workspace.create({
    data: { name: 'reopen ws', slug: 'reopen-alpha' },
  })
  const member = await db.workspaceMember.create({
    data: { workspaceId: ws.id, clerkId: CLERK, role: 'OWNER' },
  })
  await db.actor.create({
    data: { workspaceId: ws.id, type: 'HUMAN', memberId: member.id },
  })
  const team = await db.team.create({
    data: {
      workspaceId: ws.id,
      name: 'reopen team',
      identifier: 'RPN',
      isDefault: true,
    },
  })
  await db.teamMember.create({ data: { teamId: team.id, memberId: member.id } })
  const project = await db.project.create({
    data: {
      workspaceId: ws.id,
      teamId: team.id,
      createdByMemberId: member.id,
      name: 'reopen project',
    },
  })
  const task = await db.task.create({
    data: {
      projectId: project.id,
      workspaceId: ws.id,
      teamId: team.id,
      number: 1,
      title: 'reopen task',
      status: 'IN_REVIEW',
    },
  })
  const pr = await db.pullRequest.create({
    data: {
      workspaceId: ws.id,
      taskId: task.id,
      repo: 'alpha/repo',
      number: 21,
      title: 'feat',
      url: 'https://github.com/alpha/repo/pull/21',
      state: 'open',
      authorLogin: 'dev',
      headBranch: 'lumo/RPN-1-x',
      baseBranch: 'main',
      headSha: 'h2',
    },
  })
  const finding = (scanId: string, over: object) => ({
    scanId,
    kind: 'SECRET' as const,
    ruleId: 'secret:fixture-key',
    severity: 'HIGH' as const,
    provenance: 'DETERMINISTIC' as const,
    filePath: 'lib/cfg.ts',
    line: 4,
    title: 'credential-shaped literal',
    detail: 'fixture',
    evidence: 'const k = "<redacted>"',
    fingerprint: FP,
    ...over,
  })
  // Push 1: the (mistaken) ruling was made here …
  const ruledAt = new Date('2026-10-14T08:00:00Z')
  const scan1 = await db.prSecurityScan.create({
    data: {
      pullRequestId: pr.id,
      workspaceId: ws.id,
      headSha: 'h1',
      trigger: 'PR_EVENT',
      detectorVersion: 'test',
      status: 'FINDINGS',
      startedAt: new Date('2026-10-14T07:00:00Z'),
    },
  })
  const old = await db.prSecurityFinding.create({
    data: finding(scan1.id, {
      disposition: 'FALSE_POSITIVE',
      dispositionNote: 'mistaken',
      dispositionedById: member.id,
      dispositionedAt: ruledAt,
    }),
  })
  // … push 2 inherited it (the row the panel and the DONE gate read).
  const scan2 = await db.prSecurityScan.create({
    data: {
      pullRequestId: pr.id,
      workspaceId: ws.id,
      headSha: 'h2',
      trigger: 'PR_EVENT',
      detectorVersion: 'test',
      status: 'FINDINGS',
      startedAt: new Date('2026-10-14T09:00:00Z'),
    },
  })
  const latest = await db.prSecurityFinding.create({
    data: finding(scan2.id, {
      disposition: 'FALSE_POSITIVE',
      dispositionNote: 'mistaken',
      dispositionedById: member.id,
      dispositionedAt: ruledAt,
      inheritedFromFindingId: old.id,
    }),
  })
  await db.apiKey.create({
    data: {
      workspaceMemberId: member.id,
      label: 'reopen key',
      keyHash: sha256(bearerFixture),
      keyPrefix: bearerFixture.slice(0, 16),
    },
  })
  Object.assign(fx, {
    workspaceId: ws.id,
    memberId: member.id,
    taskId: task.id,
    pullRequestId: pr.id,
    oldFindingId: old.id,
    findingId: latest.id,
  })
})
afterAll(async () => harness.stop())

type Handler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => Promise<Response>

async function call(
  handler: unknown,
  method: string,
  params: Record<string, string>,
  as: { bearer?: string; clerk?: string },
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  clerkSession.userId = as.clerk ?? null
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (as.bearer) headers.authorization = `Bearer ${as.bearer}`
  const request = new NextRequest('http://localhost/x', {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  inflight.headers = request.headers
  const res = await (handler as Handler)(request, {
    params: Promise.resolve(params),
  })
  return { status: res.status, json: (await res.json()) as never }
}

const row = (id: string) =>
  harness.prisma!.prSecurityFinding.findUniqueOrThrow({ where: { id } })
const rulingActivities = () =>
  harness.prisma!.taskActivity.findMany({
    where: { taskId: fx.taskId, type: 'SECURITY_FINDING_DISPOSITIONED' },
    orderBy: { createdAt: 'asc' },
  })
/** What the next push's persistence would write for this fingerprint. */
async function inheritedOnNextPush() {
  const prior = await prSecurityScanRepository.findDispositionedByPullRequest(
    fx.pullRequestId
  )
  const [fresh] = inheritDispositions(
    [{ scanId: 'next', fingerprint: FP } as never],
    prior
  )
  return fresh as { disposition?: string | null }
}
const dispose = (as: { bearer?: string; clerk?: string }, body: unknown) =>
  call(
    dispositionRoute.POST,
    'POST',
    { id: 'RPN-1', findingId: fx.findingId },
    as,
    body
  )

test('precondition: the inherited (mistaken) ruling clears DONE and carries to the next push', async () => {
  await expect(
    assertNoOpenBlockingSecurityFindings(fx.taskId)
  ).resolves.toBeUndefined()
  expect((await inheritedOnNextPush()).disposition).toBe('FALSE_POSITIVE')
})

test('the CLI (bearer) cannot reopen — 403, nothing written', async () => {
  const res = await dispose({ bearer: bearerFixture }, { disposition: 'OPEN' })
  expect(res.status).toBe(403)
  expect(String(res.json.error)).toMatch(/web-only/)
  expect((await row(fx.findingId)).disposition).toBe('FALSE_POSITIVE')
  expect(await rulingActivities()).toHaveLength(0)
})

test('atomic: a ruling whose timeline insert fails is rolled back, not applied behind an error', async () => {
  const spy = jest
    .spyOn(activityRepository, 'create')
    .mockRejectedValueOnce(new Error('activity insert failed'))
  try {
    const res = await dispose(
      { clerk: CLERK },
      { disposition: 'ACCEPTED_RISK', note: 'real, carried' }
    )
    expect(res.status).toBe(500)
  } finally {
    spy.mockRestore()
  }
  const after = await row(fx.findingId)
  expect(after.disposition).toBe('FALSE_POSITIVE')
  expect(after.dispositionNote).toBe('mistaken')
  expect(await rulingActivities()).toHaveLength(0)
})

test('the web panel reopens it: DONE is blocked again, timeline + audit record WEB FALSE_POSITIVE → OPEN', async () => {
  const res = await dispose({ clerk: CLERK }, { disposition: 'OPEN' })
  expect(res.status).toBe(200)
  expect(res.json).toMatchObject({
    id: fx.findingId,
    disposition: null,
    blocking: true,
    channel: 'WEB',
  })
  const r = await row(fx.findingId)
  expect(r.disposition).toBeNull()
  expect(r.dispositionNote).toBeNull()
  expect(r.dispositionedAt).toBeInstanceOf(Date)

  await expect(
    assertNoOpenBlockingSecurityFindings(fx.taskId)
  ).rejects.toMatchObject({ status: 409 })
  const listed = await call(
    findingsRoute.GET,
    'GET',
    { id: 'RPN-1' },
    { bearer: bearerFixture }
  )
  expect(listed.json.findings).toEqual([
    expect.objectContaining({
      id: fx.findingId,
      blocking: true,
      disposition: null,
    }),
  ])

  const acts = await rulingActivities()
  expect(acts).toHaveLength(1)
  expect(acts[0]!.payload).toMatchObject({
    findingId: fx.findingId,
    from: 'FALSE_POSITIVE',
    to: 'OPEN',
    channel: 'WEB',
    sessionId: null,
  })
  const audits = await harness.prisma!.auditEvent.findMany({
    where: {
      workspaceId: fx.workspaceId,
      action: 'security_finding.dispositioned',
    },
  })
  expect(audits).toHaveLength(1)
  expect(audits[0]!.metadata).toMatchObject({
    from: 'FALSE_POSITIVE',
    to: 'OPEN',
  })
})

test('a reopened finding is NOT re-cleared on the next push by the older ruled row of the same fingerprint', async () => {
  // The push-1 row still carries the old ruling …
  expect((await row(fx.oldFindingId)).disposition).toBe('FALSE_POSITIVE')
  // … but the reopen is the newest verdict for the fingerprint.
  const next = await inheritedOnNextPush()
  expect(next.disposition ?? null).toBeNull()
})

test('a fresh ruling after the reopen carries over again', async () => {
  const res = await dispose(
    { bearer: bearerFixture },
    { disposition: 'ACCEPTED_RISK', note: 'user approved in chat' }
  )
  expect(res.status).toBe(200)
  expect((await inheritedOnNextPush()).disposition).toBe('ACCEPTED_RISK')
  const acts = await rulingActivities()
  expect(acts.map(a => (a.payload as { to: string }).to)).toEqual([
    'OPEN',
    'ACCEPTED_RISK',
  ])
  await expect(
    assertNoOpenBlockingSecurityFindings(fx.taskId)
  ).resolves.toBeUndefined()
})
