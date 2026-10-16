/**
 * @jest-environment node
 *
 * LUM-1191 — the spot-check pool read route (`GET /api/test-case-reviews`,
 * what `lumo spot-check` calls) is tenant-scoped on a REAL Postgres.
 *
 * Two workspaces, ALPHA and BRAVO, each with a reviewable PASS run; ALPHA also
 * has a reviewed run. The route has no id to probe, so "cross-tenant" here
 * means: each workspace's API key gets only its own runs and its own
 * false-report readout, and none of the other workspace's strings appear in
 * the body. Route, service, repository and the Bearer lookup are all real
 * (every prisma migration replayed into PGlite); only Clerk is stubbed.
 *
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
jest.mock('@clerk/nextjs/server', () => ({
  auth: jest.fn(async () => ({ userId: null })),
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
const inflight: { headers: Headers } = { headers: new Headers() }
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => inflight.headers),
}))

import { GET } from '@/app/api/test-case-reviews/route'

jest.setTimeout(240_000)

const TOKEN = {
  alpha: 'spot-check-fixture-bearer-alpha',
  bravo: 'spot-check-fixture-bearer-bravo',
}
const BRAVO_MARK = 'bravo-private'
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

async function seed(label: 'alpha' | 'bravo', token: string) {
  const db = harness.prisma!
  const mark = label === 'bravo' ? BRAVO_MARK : 'alpha-own'
  const ws = await db.workspace.create({
    data: { name: `${mark} workspace`, slug: `spot-${label}` },
  })
  const owner = await db.workspaceMember.create({
    data: { workspaceId: ws.id, clerkId: `user_spot_${label}`, role: 'OWNER' },
  })
  await db.actor.create({
    data: { workspaceId: ws.id, type: 'HUMAN', memberId: owner.id },
  })
  await db.apiKey.create({
    data: {
      workspaceMemberId: owner.id,
      label: `${label} key`,
      keyHash: sha256(token),
      keyPrefix: token.slice(0, 16),
    },
  })
  // Both workspaces share the team identifier, so only the workspace filter
  // tells their runs apart.
  const team = await db.team.create({
    data: {
      workspaceId: ws.id,
      name: `${mark} team`,
      identifier: 'SPOT',
      isDefault: true,
    },
  })
  const project = await db.project.create({
    data: {
      workspaceId: ws.id,
      teamId: team.id,
      createdByMemberId: owner.id,
      name: `${mark} project`,
    },
  })
  const task = await db.task.create({
    data: {
      projectId: project.id,
      workspaceId: ws.id,
      teamId: team.id,
      number: 1,
      title: `${mark} task`,
    },
  })
  const run = async (caseNumber: number) => {
    const tc = await db.testCase.create({
      data: {
        taskId: task.id,
        number: caseNumber,
        title: `${mark} case ${caseNumber}`,
        steps: ['open the page'],
        verification: [],
        expected: `${mark} expected`,
      },
    })
    return db.testCaseRun.create({
      data: {
        testCaseId: tc.id,
        taskId: task.id,
        result: 'PASS',
        environment: 'PRODUCTION',
        evidence: [{ type: 'link', url: `https://example.test/${label}.log` }],
        stepResults: [
          { phase: 'STEP', index: 0, text: 'open the page', status: 'PASS' },
        ],
        executedByMemberId: owner.id,
        sourceSessionId: `${label}-session`,
      },
    })
  }
  const waiting = await run(1)
  let reviewed: string | null = null
  if (label === 'alpha') {
    const r = await run(2)
    await db.testCaseRunReview.create({
      data: {
        testCaseRunId: r.id,
        taskId: task.id,
        accepted: false,
        reviewedByMemberId: owner.id,
      },
    })
    reviewed = r.id
  }
  return {
    memberId: owner.id,
    waitingRunId: waiting.id,
    reviewedRunId: reviewed,
  }
}

const fx: Record<'alpha' | 'bravo', Awaited<ReturnType<typeof seed>> | null> = {
  alpha: null,
  bravo: null,
}

beforeAll(async () => {
  await harness.start()
  holder.client = withSoftDelete(harness.prisma!)
  fx.alpha = await seed('alpha', TOKEN.alpha)
  fx.bravo = await seed('bravo', TOKEN.bravo)
})

afterAll(async () => {
  await harness.stop()
})

async function get(token: string | null) {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  const request = new NextRequest('http://localhost/api/test-case-reviews', {
    headers,
  })
  inflight.headers = request.headers
  const res = await GET(request)
  return { status: res.status, text: await res.text() }
}

describe('LUM-1191 spot-check pool is tenant-scoped (real Postgres)', () => {
  it('ALPHA’s key sees only ALPHA’s waiting run and ALPHA’s review', async () => {
    const res = await get(TOKEN.alpha)
    expect(res.status).toBe(200)
    expect(res.text).not.toContain(BRAVO_MARK)
    const body = JSON.parse(res.text)
    expect(body.poolSize).toBe(1)
    expect(body.sample).toHaveLength(1)
    expect(body.sample[0]).toMatchObject({
      runId: fx.alpha!.waitingRunId,
      taskIdentifier: 'SPOT-1',
      caseNumber: 1,
      environment: 'PRODUCTION',
      // Clerk returns nobody → the member id, never "nobody"
      executedBy: fx.alpha!.memberId,
      sourceSessionId: 'alpha-session',
    })
    expect(body.rate).toMatchObject({ reviewed: 1, rejected: 1 })
  })

  it('BRAVO’s key (fixture control) sees BRAVO’s run and none of ALPHA’s review', async () => {
    const res = await get(TOKEN.bravo)
    expect(res.status).toBe(200)
    expect(res.text).not.toContain('alpha-own')
    const body = JSON.parse(res.text)
    expect(body.sample.map((i: { runId: string }) => i.runId)).toEqual([
      fx.bravo!.waitingRunId,
    ])
    expect(body.rate).toMatchObject({ reviewed: 0, rejected: 0 })
  })

  it('no credential → 401 with no data', async () => {
    const res = await get(null)
    expect(res.status).toBe(401)
    expect(res.text).not.toContain('alpha-own')
    expect(res.text).not.toContain(BRAVO_MARK)
  })
})
