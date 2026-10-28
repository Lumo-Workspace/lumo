/**
 * @jest-environment node
 *
 * LUM-1128 — `lumo finding disposition` server path, end to end against a
 * REAL Postgres (every migration replayed into PGlite): the real Bearer
 * lookup (sha256 of the token in `api_keys`), the real route handlers,
 * service, repositories, activity + audit writes and the DONE gate function.
 * Only the identity provider, outbound side effects and `next/headers` are
 * stubbed, as in the cross-tenant suite.
 *
 * Covers: a CLI ruling is recorded with channel CLI + session + time on the
 * task timeline and as a CLI-source audit event; it clears the DONE gate; a
 * caller from another workspace gets 404 and changes nothing; the web panel
 * can then correct the CLI ruling.
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
jest.mock('@/lib/auth/session', () => ({
  getCurrentUserId: async () => clerkSession.userId,
  getCurrentUser: async () => null,
}))
jest.mock('@/lib/auth/users', () => {
  const directory = {
    getUserList: jest.fn(async () => ({ data: [], totalCount: 0 })),
    getUser: jest.fn(async () => {
      throw Object.assign(new Error('directory stub: no user'), { status: 404 })
    }),
  }
  return {
    getUserDirectory: async () => directory,
    createUserDirectory: async () => directory,
    isUserDirectoryConfigured: () => true,
  }
})
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

jest.setTimeout(240_000)

/** Readable, non-secret-shaped fixture tokens (only their sha256 is stored). */
const TOKEN = {
  alpha: 'finding-fixture-bearer-alpha',
  bravo: 'finding-fixture-bearer-bravo',
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

interface Fx {
  workspaceId: string
  memberId: string
  taskId: string
  findingId: string
}
const fx: { alpha: Fx | null; bravo: Fx | null } = { alpha: null, bravo: null }

async function seed(label: 'alpha' | 'bravo', token: string): Promise<Fx> {
  const db = harness.prisma!
  const ws = await db.workspace.create({
    data: { name: `${label} ws`, slug: `finding-${label}` },
  })
  const member = await db.workspaceMember.create({
    data: {
      workspaceId: ws.id,
      clerkId: `user_finding_${label}`,
      role: 'OWNER',
    },
  })
  await db.actor.create({
    data: { workspaceId: ws.id, type: 'HUMAN', memberId: member.id },
  })
  const team = await db.team.create({
    data: {
      workspaceId: ws.id,
      name: `${label} team`,
      identifier: 'FND',
      isDefault: true,
    },
  })
  await db.teamMember.create({ data: { teamId: team.id, memberId: member.id } })
  const project = await db.project.create({
    data: {
      workspaceId: ws.id,
      teamId: team.id,
      createdByMemberId: member.id,
      name: `${label} project`,
    },
  })
  const task = await db.task.create({
    data: {
      projectId: project.id,
      workspaceId: ws.id,
      teamId: team.id,
      number: 1,
      title: `${label} task`,
      status: 'IN_REVIEW',
    },
  })
  const pr = await db.pullRequest.create({
    data: {
      workspaceId: ws.id,
      taskId: task.id,
      repo: `${label}/repo`,
      number: 11,
      title: 'feat',
      url: `https://github.com/${label}/repo/pull/11`,
      state: 'open',
      authorLogin: 'dev',
      headBranch: 'lumo/FND-1-x',
      baseBranch: 'main',
      headSha: 'h1',
    },
  })
  const scan = await db.prSecurityScan.create({
    data: {
      pullRequestId: pr.id,
      workspaceId: ws.id,
      headSha: 'h1',
      trigger: 'PR_EVENT',
      detectorVersion: 'test',
      status: 'FINDINGS',
    },
  })
  const finding = await db.prSecurityFinding.create({
    data: {
      scanId: scan.id,
      kind: 'SECRET',
      ruleId: 'secret:fixture-key',
      severity: 'HIGH',
      provenance: 'DETERMINISTIC',
      filePath: 'lib/cfg.ts',
      line: 4,
      title: `${label} credential-shaped literal`,
      detail: 'fixture',
      evidence: 'const k = "<redacted>"',
      fingerprint: `fp-${label}`,
    },
  })
  await db.apiKey.create({
    data: {
      workspaceMemberId: member.id,
      label: `${label} key`,
      keyHash: sha256(token),
      keyPrefix: token.slice(0, 16),
    },
  })
  return {
    workspaceId: ws.id,
    memberId: member.id,
    taskId: task.id,
    findingId: finding.id,
  }
}

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  fx.alpha = await seed('alpha', TOKEN.alpha)
  fx.bravo = await seed('bravo', TOKEN.bravo)
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
  as: { bearer?: string; clerk?: string; sessionId?: string },
  body?: unknown
): Promise<{ status: number; json: Record<string, unknown> }> {
  clerkSession.userId = as.clerk ?? null
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (as.bearer) headers.authorization = `Bearer ${as.bearer}`
  if (as.sessionId) headers['X-Lumo-Session-Id'] = as.sessionId
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

const findingRow = (id: string) =>
  harness.prisma!.prSecurityFinding.findUniqueOrThrow({ where: { id } })

test('the finding blocks DONE before any ruling, and the bearer read lists it as blocking', async () => {
  const a = fx.alpha!
  await expect(
    assertNoOpenBlockingSecurityFindings(a.taskId)
  ).rejects.toMatchObject({ status: 409 })
  const listed = await call(
    findingsRoute.GET,
    'GET',
    { id: 'FND-1' },
    {
      bearer: TOKEN.alpha,
    }
  )
  expect(listed.status).toBe(200)
  expect(listed.json.findings).toEqual([
    expect.objectContaining({
      id: a.findingId,
      severity: 'HIGH',
      prNumber: 11,
      blocking: true,
      disposition: null,
    }),
  ])
})

test('tenant isolation: another workspace cannot read or rule on the finding (404, nothing written)', async () => {
  const a = fx.alpha!
  // ALPHA's task by cuid from BRAVO's key.
  const byCuid = await call(
    dispositionRoute.POST,
    'POST',
    { id: a.taskId, findingId: a.findingId },
    { bearer: TOKEN.bravo },
    { disposition: 'FALSE_POSITIVE' }
  )
  expect(byCuid.status).toBe(404)
  // ALPHA's finding id under BRAVO's own task (same identifier FND-1).
  const crossed = await call(
    dispositionRoute.POST,
    'POST',
    { id: 'FND-1', findingId: a.findingId },
    { bearer: TOKEN.bravo },
    { disposition: 'FALSE_POSITIVE' }
  )
  expect(crossed.status).toBe(404)
  const read = await call(
    findingsRoute.GET,
    'GET',
    { id: a.taskId },
    {
      bearer: TOKEN.bravo,
    }
  )
  expect(read.status).toBe(404)
  expect((await findingRow(a.findingId)).disposition).toBeNull()
  expect(
    await harness.prisma!.taskActivity.count({
      where: { type: 'SECURITY_FINDING_DISPOSITIONED' },
    })
  ).toBe(0)
})

test('a CLI ruling (agent session header, no guard) is recorded as channel CLI and clears the DONE gate', async () => {
  const a = fx.alpha!
  const res = await call(
    dispositionRoute.POST,
    'POST',
    { id: 'FND-1', findingId: a.findingId },
    { bearer: TOKEN.alpha, sessionId: 'agent-session-1' },
    { disposition: 'FALSE_POSITIVE', note: 'approved by the user in chat' }
  )
  expect(res.status).toBe(200)
  expect(res.json).toMatchObject({
    id: a.findingId,
    disposition: 'FALSE_POSITIVE',
    blocking: false,
    channel: 'CLI',
  })

  const row = await findingRow(a.findingId)
  expect(row).toMatchObject({
    disposition: 'FALSE_POSITIVE',
    dispositionNote: 'approved by the user in chat',
    dispositionedById: a.memberId,
  })
  expect(row.dispositionedAt).toBeInstanceOf(Date)

  const activities = await harness.prisma!.taskActivity.findMany({
    where: { taskId: a.taskId, type: 'SECURITY_FINDING_DISPOSITIONED' },
  })
  expect(activities).toHaveLength(1)
  expect(activities[0]!.actorId).not.toBeNull()
  expect(activities[0]!.payload).toMatchObject({
    findingId: a.findingId,
    from: null,
    to: 'FALSE_POSITIVE',
    channel: 'CLI',
    sessionId: 'agent-session-1',
  })
  expect(
    Number.isNaN(
      Date.parse(
        (activities[0]!.payload as { confirmedAt: string }).confirmedAt
      )
    )
  ).toBe(false)

  const audits = await harness.prisma!.auditEvent.findMany({
    where: {
      workspaceId: a.workspaceId,
      action: 'security_finding.dispositioned',
    },
  })
  expect(audits).toHaveLength(1)
  expect(audits[0]).toMatchObject({
    source: 'CLI',
    targetId: a.findingId,
    actorMemberId: a.memberId,
  })

  await expect(
    assertNoOpenBlockingSecurityFindings(a.taskId)
  ).resolves.toBeUndefined()
  const listed = await call(
    findingsRoute.GET,
    'GET',
    { id: 'FND-1' },
    {
      bearer: TOKEN.alpha,
    }
  )
  expect(listed.json.findings).toEqual([
    expect.objectContaining({ id: a.findingId, blocking: false }),
  ])
  // BRAVO's identical finding is untouched.
  expect((await findingRow(fx.bravo!.findingId)).disposition).toBeNull()
})
