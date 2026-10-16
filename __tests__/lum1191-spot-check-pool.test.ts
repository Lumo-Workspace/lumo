/**
 * @jest-environment node
 *
 * LUM-1191: the spot-check pool read route that `lumo spot-check` uses.
 *
 * - each sampled run carries who ran it (display name, null = not recorded)
 *   and the source session, resolved only for the sampled rows;
 * - GET /api/test-case-reviews is workspace-scoped: it takes the workspace
 *   from the authenticated identity only, so a bearer of workspace B never
 *   sees workspace A's runs or rate;
 * - the review write stays human-only (bearer → 403).
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories/test-case-run-review.repository', () => ({
  testCaseRunReviewRepository: {
    create: jest.fn(),
    listForWorkspace: jest.fn(),
    listPassCandidates: jest.fn(),
    findCandidate: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    labelsByIds: jest.fn(
      async (ids: string[]) =>
        new Map(
          ids.filter(id => id !== 'm-gone').map(id => [id, `name-of-${id}`])
        )
    ),
  },
}))

import { GET } from '@/app/api/test-case-reviews/route'
import { POST } from '@/app/api/test-case-reviews/[runId]/route'
import { requireIdentity } from '@/lib/auth'
import { testCaseRunReviewRepository } from '@/lib/repositories/test-case-run-review.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { testCaseReviewService } from '@/lib/services/test-case-review.service'

const mockIdentity = requireIdentity as jest.Mock
const repo = testCaseRunReviewRepository as unknown as Record<string, jest.Mock>
const labels = memberRepository.labelsByIds as jest.Mock

function candidate(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    taskId: 't-1',
    result: 'PASS',
    environment: 'PRODUCTION',
    unprovenVerification: [],
    evidence: [{ type: 'link', url: 'https://example.test/log' }],
    stepResults: [],
    note: null,
    commitSha: 'abcdef1234',
    commitDirty: false,
    executedByMemberId: null,
    sourceSessionId: null,
    createdAt: new Date('2026-09-23T08:00:00Z'),
    testCase: {
      number: 3,
      title: 'login works',
      requiredEnvironment: null,
      setup: null,
      steps: ['open'],
      verification: [],
      expected: 'ok',
    },
    pullRequest: null,
    task: { number: 42, title: 'Login', team: { identifier: 'LUM' } },
    ...over,
  }
}

const bearer = (workspaceId: string) => ({
  clerkId: 'clerk-1',
  memberId: `member-${workspaceId}`,
  workspaceId,
  source: 'bearer' as const,
})

beforeEach(() => {
  jest.clearAllMocks()
  repo.listForWorkspace!.mockResolvedValue([])
})

describe('LUM-1191 spot-check pool', () => {
  it('each sampled run carries its runner (null = not recorded) and source session', async () => {
    repo.listPassCandidates!.mockResolvedValue([
      candidate('run-a', {
        executedByMemberId: 'm-1',
        sourceSessionId: 'sess-1',
      }),
      candidate('run-b'),
      candidate('run-c', { executedByMemberId: 'm-gone' }),
    ])
    const view = await testCaseReviewService.getPool('w-1', {
      random: () => 0.999,
    })
    const byId = new Map(view.sample.map(i => [i.runId, i]))
    expect(byId.get('run-a')).toMatchObject({
      executedBy: 'name-of-m-1',
      sourceSessionId: 'sess-1',
    })
    expect(byId.get('run-b')).toMatchObject({
      executedBy: null,
      sourceSessionId: null,
    })
    // a cleaned-up member falls back to the member id, never to "nobody"
    expect(byId.get('run-c')!.executedBy).toBe('m-gone')
    expect(labels).toHaveBeenCalledTimes(1)
    expect(new Set(labels.mock.calls[0]![0])).toEqual(
      new Set(['m-1', 'm-gone'])
    )
  })

  it('resolves runners for the sampled rows only, not the whole pool', async () => {
    repo.listPassCandidates!.mockResolvedValue([
      candidate('run-a', { executedByMemberId: 'm-1' }),
      candidate('run-b', { executedByMemberId: 'm-2' }),
      candidate('run-c', { executedByMemberId: 'm-3' }),
    ])
    const view = await testCaseReviewService.getPool('w-1', {
      sampleSize: 1,
      random: () => 0,
    })
    expect(view.sample).toHaveLength(1)
    expect(labels.mock.calls[0]![0]).toEqual([
      view.sample[0]!.executedBy!.replace('name-of-', ''),
    ])
  })

  it('GET is scoped to the caller’s workspace — another tenant sees none of it', async () => {
    repo.listPassCandidates!.mockImplementation(async (ws: string) =>
      ws === 'w-A' ? [candidate('run-of-A')] : []
    )
    repo.listForWorkspace!.mockImplementation(async (ws: string) =>
      ws === 'w-A'
        ? [{ testCaseRunId: 'x', accepted: false, createdAt: new Date() }]
        : []
    )

    mockIdentity.mockResolvedValue(bearer('w-A'))
    const a = await GET({ headers: { get: () => null } } as never)
    expect(a.status).toBe(200)
    const aBody = await a.json()
    expect(aBody.sample.map((i: { runId: string }) => i.runId)).toEqual([
      'run-of-A',
    ])
    expect(aBody.rate.reviewed).toBe(1)

    mockIdentity.mockResolvedValue(bearer('w-B'))
    const b = await GET({ headers: { get: () => null } } as never)
    expect(b.status).toBe(200)
    const bBody = await b.json()
    expect(bBody.sample).toEqual([])
    expect(bBody.poolSize).toBe(0)
    expect(bBody.rate.reviewed).toBe(0)
    // the workspace always comes from the identity, never from the request
    expect(repo.listPassCandidates!.mock.calls.map(c => c[0])).toEqual([
      'w-A',
      'w-B',
    ])
  })

  it('the review write stays human-only: a bearer is refused before anything is read', async () => {
    mockIdentity.mockResolvedValue(bearer('w-A'))
    const json = jest.fn(async () => ({ accepted: true }))
    const res = await POST({ json, headers: { get: () => null } } as never, {
      params: Promise.resolve({ runId: 'run-of-A' }),
    })
    expect(res.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(repo.findCandidate).not.toHaveBeenCalled()
    expect(repo.create).not.toHaveBeenCalled()
  })
})
