/**
 * @jest-environment node
 *
 * LUM-819 (D): 抽查池与虚报率。
 *
 * - 复核只能人点：bearer（agent / CLI）在解析 body 之前就 403，一行都不写。
 * - append-only：同一条 run 改主意就再 append 一条，读端取最新。
 * - 池子 = 封顶后仍是 PASS（有证据、环境对、没有未观察项）且还没人复核的 run。
 * - 虚报率 = 最新复核为打回的 run 数 / 已复核 run 数；样本不足只报计数。
 * - 无证据封顶与复核都**不拦 DONE**。
 */
import { POST } from '@/app/api/test-case-reviews/[runId]/route'
import { GET } from '@/app/api/test-case-reviews/route'
import { requireIdentity } from '@/lib/auth'
import { testCaseRunReviewRepository } from '@/lib/repositories/test-case-run-review.repository'
import { testCaseReviewService } from '@/lib/services/test-case-review.service'
import {
  addReviewToRate,
  deriveFalseReportRate,
  deriveReviewPool,
  FALSE_REPORT_MIN_SAMPLE,
  latestReviewByRun,
  sampleForReview,
  type ReviewableRun,
  type ReviewRow,
} from '@/lib/test-cases/review'
import { computeDoneVerdict } from '@/lib/acceptance/done-verdict'
import { readFileSync } from 'fs'
import { join } from 'path'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories/test-case-run-review.repository', () => ({
  testCaseRunReviewRepository: {
    create: jest.fn(),
    listForWorkspace: jest.fn(),
    listPassCandidates: jest.fn(),
    findCandidate: jest.fn(),
    contractsForTasks: jest.fn(async () => new Map()),
  },
}))

const mockIdentity = requireIdentity as jest.Mock
const repo = testCaseRunReviewRepository as unknown as Record<string, jest.Mock>

const CLERK = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'clerk' as const,
}
const BEARER = { ...CLERK, source: 'bearer' as const }

function candidate(over: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    taskId: 't-1',
    result: 'PASS',
    environment: 'PRODUCTION',
    unprovenVerification: [],
    evidence: [{ type: 'link', url: 'https://example.test/log' }],
    note: null,
    commitSha: 'abcdef1234',
    commitDirty: false,
    createdAt: new Date('2026-09-23T08:00:00Z'),
    testCase: { number: 3, title: 'login works', requiredEnvironment: null },
    task: { number: 42, title: 'Login', team: { identifier: 'LUM' } },
    ...over,
  }
}

function postReq(body: unknown) {
  const json = jest.fn(async () => body)
  return { req: { json, headers: { get: () => null } } as never, json }
}
const params = { params: Promise.resolve({ runId: 'run-1' }) }

function reviewable(over: Partial<ReviewableRun> = {}): ReviewableRun {
  return {
    id: 'r',
    result: 'PASS',
    environment: 'LOCAL',
    unprovenVerification: [],
    evidenceCount: 1,
    requiredEnvironment: null,
    ...over,
  }
}

const at = (m: number) => new Date(Date.UTC(2026, 8, 23, 0, m))
const review = (runId: string, accepted: boolean, m: number): ReviewRow => ({
  testCaseRunId: runId,
  accepted,
  createdAt: at(m),
})

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(CLERK)
  repo.findCandidate!.mockResolvedValue(candidate())
  repo.create!.mockImplementation(async (d: Record<string, unknown>) => ({
    id: `rev-${repo.create!.mock.calls.length}`,
    ...d,
    createdAt: new Date('2026-09-23T09:00:00Z'),
  }))
})

describe('LUM-819 run review', () => {
  it('only a browser session can review a run, and reviews are append-only', async () => {
    // bearer: 403 before the body is parsed; nothing read, nothing written
    mockIdentity.mockResolvedValue(BEARER)
    const bearer = postReq({ accepted: true })
    const refused = await POST(bearer.req, params)
    expect(refused.status).toBe(403)
    expect(bearer.json).not.toHaveBeenCalled()
    expect(repo.findCandidate).not.toHaveBeenCalled()
    expect(repo.create).not.toHaveBeenCalled()

    // clerk: recorded, attributed to the session's member, never to the body
    mockIdentity.mockResolvedValue(CLERK)
    const ok = await POST(
      postReq({ accepted: true, note: ' fine ' }).req,
      params
    )
    expect(ok.status).toBe(200)
    expect(repo.findCandidate).toHaveBeenCalledWith('run-1', 'w-1')
    expect(repo.create).toHaveBeenLastCalledWith({
      testCaseRunId: 'run-1',
      taskId: 't-1',
      accepted: true,
      note: 'fine',
      reviewedByMemberId: 'member-1',
    })
    // a smuggled reviewer field is rejected by the strict schema
    const smuggled = await POST(
      postReq({ accepted: true, reviewedByMemberId: 'someone-else' }).req,
      params
    )
    expect(smuggled.status).toBe(400)

    // changing one's mind appends a second row — there is no update path
    await POST(postReq({ accepted: false }).req, params)
    expect(repo.create).toHaveBeenCalledTimes(2)
    expect(Object.keys(testCaseRunReviewRepository)).not.toEqual(
      expect.arrayContaining(['update'])
    )
    const src = readFileSync(
      join(
        process.cwd(),
        'lib/repositories/test-case-run-review.repository.ts'
      ),
      'utf8'
    )
    expect(src).not.toMatch(
      /testCaseRunReview\.(update|updateMany|delete|deleteMany|upsert)\(/
    )
    const latest = latestReviewByRun([
      review('run-1', true, 1),
      review('run-1', false, 2),
    ])
    expect(latest.get('run-1')!.accepted).toBe(false)

    // a run whose PASS no longer stands cannot be reviewed; another tenant's run is 404
    repo.findCandidate!.mockResolvedValueOnce(candidate({ evidence: [] }))
    expect((await POST(postReq({ accepted: true }).req, params)).status).toBe(
      409
    )
    repo.findCandidate!.mockResolvedValueOnce(null)
    expect((await POST(postReq({ accepted: true }).req, params)).status).toBe(
      404
    )
  })

  it('the review pool and false-report rate derive from the latest human review', async () => {
    // pool: effective PASS only, and never reviewed
    const runs = [
      reviewable({ id: 'good' }),
      reviewable({ id: 'no-evidence', evidenceCount: 0 }),
      reviewable({ id: 'failed', result: 'FAIL' }),
      reviewable({ id: 'wrong-env', requiredEnvironment: 'PRODUCTION' }),
      reviewable({
        id: 'unobserved',
        unprovenVerification: [{ index: 0, text: 'x' }],
      }),
      reviewable({ id: 'already-reviewed' }),
    ]
    expect(
      deriveReviewPool(runs, [review('already-reviewed', true, 1)]).map(
        r => r.id
      )
    ).toEqual(['good'])

    // sampling is a shuffle of the pool, capped at the requested size
    const pool = ['a', 'b', 'c', 'd']
    const drawn = sampleForReview(pool, 2, () => 0)
    expect(drawn).toHaveLength(2)
    expect(pool).toEqual(['a', 'b', 'c', 'd'])
    expect(new Set(sampleForReview(pool, 10, () => 0.5))).toEqual(new Set(pool))

    // rate: below the floor → counts only, no ratio
    const few = deriveFalseReportRate([
      review('a', false, 1),
      review('b', true, 1),
    ])
    expect(few).toEqual({
      status: 'insufficient',
      reviewed: 2,
      rejected: 1,
      minSample: FALSE_REPORT_MIN_SAMPLE,
    })
    expect(few).not.toHaveProperty('rate')

    // at the floor: rate over runs, using each run's LATEST review
    const many: ReviewRow[] = []
    for (let i = 0; i < FALSE_REPORT_MIN_SAMPLE; i++)
      many.push(review(`r${i}`, i >= 3, 1))
    many.push(review('r0', true, 5)) // r0 changed its mind: rejected → accepted
    expect(deriveFalseReportRate(many)).toEqual({
      status: 'measured',
      reviewed: FALSE_REPORT_MIN_SAMPLE,
      rejected: 2,
      rate: 2 / FALSE_REPORT_MIN_SAMPLE,
    })

    // the page folds a fresh review in locally with the same arithmetic
    const nine = deriveFalseReportRate(
      many.slice(0, FALSE_REPORT_MIN_SAMPLE - 1)
    )
    expect(addReviewToRate(nine, false)).toEqual(
      deriveFalseReportRate([
        ...many.slice(0, FALSE_REPORT_MIN_SAMPLE - 1),
        review('new', false, 9),
      ])
    )

    // service: pool excludes reviewed and zero-evidence runs; flat DTO
    repo.listPassCandidates!.mockResolvedValue([
      candidate({ id: 'run-a' }),
      candidate({ id: 'run-b', evidence: [] }),
      candidate({ id: 'run-c' }),
    ])
    repo.listForWorkspace!.mockResolvedValue([review('run-c', true, 1)])
    const view = await testCaseReviewService.getPool('w-1', { random: () => 0 })
    expect(view.poolSize).toBe(1)
    expect(view.sample).toEqual([
      expect.objectContaining({
        runId: 'run-a',
        taskIdentifier: 'LUM-42',
        caseNumber: 3,
        caseTitle: 'login works',
        recordedAt: '2026-09-23T08:00:00.000Z',
      }),
    ])
    expect(view.rate).toMatchObject({ status: 'insufficient', reviewed: 1 })

    // the read route is open to any identity (reads never mint a ruling)
    mockIdentity.mockResolvedValue(BEARER)
    expect((await GET({ headers: { get: () => null } } as never)).status).toBe(
      200
    )
  })

  it('evidence ceilings and run reviews never block DONE', () => {
    const verdict = computeDoneVerdict({
      crossings: { open: [], gateEnabled: true },
      securityFindings: [],
      testCases: [
        {
          number: 1,
          title: 'login works',
          signal: 'UNPROVEN_PASS',
          runId: 'run-1',
          dispositioned: false,
          ceilingReason: 'no-evidence',
        },
      ],
    })
    expect(verdict.decision).toBe('CLEAR')
    expect(verdict.blockers).toEqual([])
    expect(verdict.advisories).toEqual([
      expect.objectContaining({
        signal: 'UNPROVEN_PASS',
        ceilingReason: 'no-evidence',
      }),
    ])

    // the gate has no path to review data at all
    for (const f of [
      'lib/acceptance/done-verdict.ts',
      'lib/services/done-verdict.service.ts',
    ]) {
      const src = readFileSync(join(process.cwd(), f), 'utf8')
      expect(src).not.toMatch(/review/i)
    }
  })
})
