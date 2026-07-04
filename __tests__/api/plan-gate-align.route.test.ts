/**
 * @jest-environment node
 *
 * Gate B (闸门B · 对齐确认) confirm endpoint — LUM-670, Spec2-8.
 *
 * Exercises the REAL route → service → state-machine → validation stack, mocking
 * only the auth boundary and the plan-run repository. This proves the acceptance
 * contract end to end: the confirm endpoint writes the verdict switches + star
 * selections into the ALIGN stage record's `humanConfirmedOutput`, advances the
 * run to GENERATING, and passes only the (≤2) starred ALIGNED clusters to Stage 3.
 */
import { GET, POST } from '@/app/api/plan-runs/[runId]/gate/align/route'
import { requireIdentity } from '@/lib/auth'
import { planRunRepository } from '@/lib/repositories/plan-run.repository'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories/plan-run.repository', () => ({
  planRunRepository: {
    findById: jest.fn(),
    findStageRecord: jest.fn(),
    confirmStageRecord: jest.fn(),
    updateStage: jest.fn(),
  },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindById = planRunRepository.findById as jest.Mock
const mockFindStageRecord = planRunRepository.findStageRecord as jest.Mock
const mockConfirmStageRecord = planRunRepository.confirmStageRecord as jest.Mock
const mockUpdateStage = planRunRepository.updateStage as jest.Mock

const IDENTITY = {
  clerkId: 'clerk-1',
  memberId: 'member-1',
  workspaceId: 'w-1',
  source: 'bearer' as const,
}

const RUN_ID = 'run-1'

// Three aligned clusters as the Stage-2 LLM left them (pre-gate).
const ALIGN_RAW = {
  priorityDeclared: true,
  clusters: [
    {
      clusterId: 'c1',
      verdict: 'ALIGNED',
      rationale: 'serves priority',
      customizationTrap: false,
    },
    {
      clusterId: 'c2',
      verdict: 'UNRELATED',
      rationale: 'park it',
      customizationTrap: true,
    },
    {
      clusterId: 'c3',
      verdict: 'ALIGNED',
      rationale: 'also on-priority',
      customizationTrap: false,
    },
  ],
}

function alignReadyRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    teamId: 't-1',
    workspaceId: 'w-1',
    stage: 'ALIGNMENT_READY',
    startedByMemberId: 'member-1',
    inputIdeaIds: [],
    priorityId: null,
    prioritySnapshot: 'ship faster',
    proseDocument: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function alignRecord(rawOutput: unknown = ALIGN_RAW) {
  return {
    id: 'rec-1',
    planRunId: RUN_ID,
    kind: 'ALIGN',
    model: 'test-model',
    promptTokens: 0,
    outputTokens: 0,
    llmInput: '',
    llmRawOutput: rawOutput,
    humanConfirmedOutput: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function req(body?: unknown) {
  return {
    json: async () => {
      if (body === undefined) throw new Error('no body')
      return body
    },
    headers: { get: () => null },
  } as never
}

const params = { params: Promise.resolve({ runId: RUN_ID }) }

beforeEach(() => {
  jest.clearAllMocks()
  mockIdentity.mockResolvedValue(IDENTITY)
  mockFindById.mockResolvedValue(alignReadyRun())
  mockFindStageRecord.mockResolvedValue(alignRecord())
  mockConfirmStageRecord.mockResolvedValue(alignRecord())
  mockUpdateStage.mockImplementation(async (_id: string, stage: string) =>
    alignReadyRun({ stage })
  )
})

// ── happy path ────────────────────────────────────────────────────────────────

describe('POST /api/plan-runs/[runId]/gate/align — confirm', () => {
  it('freezes verdict switches + stars into humanConfirmedOutput and advances to GENERATING', async () => {
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'c1',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'serves priority',
          },
          // switch c2 UNRELATED → CONFLICT and edit its rationale
          {
            clusterId: 'c2',
            verdict: 'CONFLICT',
            starred: false,
            rationale: 'pulls against priority',
          },
          {
            clusterId: 'c3',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'also on-priority',
          },
        ],
      }),
      params
    )
    expect(res.status).toBe(200)

    // humanConfirmedOutput carries every verdict switch + star, keyed by cluster.
    expect(mockConfirmStageRecord).toHaveBeenCalledTimes(1)
    const [planRunId, kind, data] = mockConfirmStageRecord.mock.calls[0]
    expect(planRunId).toBe(RUN_ID)
    expect(kind).toBe('ALIGN')
    expect(data.confirmedBy).toBe('member-1')
    expect(data.humanConfirmedOutput.clusters).toEqual([
      {
        clusterId: 'c1',
        verdict: 'ALIGNED',
        starred: true,
        rationale: 'serves priority',
        customizationTrap: false,
      },
      {
        clusterId: 'c2',
        verdict: 'CONFLICT',
        starred: false,
        rationale: 'pulls against priority',
        customizationTrap: true,
      },
      {
        clusterId: 'c3',
        verdict: 'ALIGNED',
        starred: true,
        rationale: 'also on-priority',
        customizationTrap: false,
      },
    ])

    // advanced the run ALIGNMENT_READY → GENERATING
    expect(mockUpdateStage).toHaveBeenCalledWith(RUN_ID, 'GENERATING')

    const json = await res.json()
    expect(json.run.stage).toBe('GENERATING')
    // only the (≤2) starred ALIGNED clusters flow downstream to Stage 3
    expect(json.selectedClusterIds).toEqual(['c1', 'c3'])
  })

  it('the customization-trap flag is taken from the ALIGN record, not the request', async () => {
    await POST(
      req({
        clusters: [
          {
            clusterId: 'c1',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'x',
          },
          // even if a client tried to smuggle customizationTrap, it is ignored;
          // c2's trap=true comes from the frozen ALIGN record.
          {
            clusterId: 'c2',
            verdict: 'UNRELATED',
            starred: false,
            rationale: 'y',
            customizationTrap: false,
          },
          {
            clusterId: 'c3',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'z',
          },
        ],
      }),
      params
    )
    const data = mockConfirmStageRecord.mock.calls[0][2]
    expect(
      data.humanConfirmedOutput.clusters.find(
        (c: { clusterId: string }) => c.clusterId === 'c2'
      ).customizationTrap
    ).toBe(true)
  })

  it('passes at most 2 clusters downstream even when only ALIGNED-and-starred qualify', async () => {
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'c1',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'a',
          },
          {
            clusterId: 'c2',
            verdict: 'UNRELATED',
            starred: false,
            rationale: 'b',
          },
          {
            clusterId: 'c3',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'c',
          },
        ],
      }),
      params
    )
    const json = await res.json()
    // c3 is ALIGNED but unstarred → shelved; c2 unrelated → shelved.
    expect(json.selectedClusterIds).toEqual(['c1'])
  })
})

// ── validation & guards ─────────────────────────────────────────────────────

describe('POST /api/plan-runs/[runId]/gate/align — guards', () => {
  it('400 when more than 2 clusters are starred (never advances)', async () => {
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'c1',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'a',
          },
          {
            clusterId: 'c2',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'b',
          },
          {
            clusterId: 'c3',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'c',
          },
        ],
      }),
      params
    )
    expect(res.status).toBe(400)
    expect(mockConfirmStageRecord).not.toHaveBeenCalled()
    expect(mockUpdateStage).not.toHaveBeenCalled()
  })

  it('400 when a non-ALIGNED cluster is starred', async () => {
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'c1',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'a',
          },
          {
            clusterId: 'c2',
            verdict: 'CONFLICT',
            starred: true,
            rationale: 'b',
          },
          {
            clusterId: 'c3',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'c',
          },
        ],
      }),
      params
    )
    expect(res.status).toBe(400)
    expect(mockConfirmStageRecord).not.toHaveBeenCalled()
  })

  it('422 when the confirmation does not cover every aligned cluster', async () => {
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'c1',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'a',
          },
          {
            clusterId: 'c2',
            verdict: 'UNRELATED',
            starred: false,
            rationale: 'b',
          },
        ],
      }),
      params
    )
    expect(res.status).toBe(422)
    expect(mockConfirmStageRecord).not.toHaveBeenCalled()
  })

  it('422 when an unknown clusterId is submitted', async () => {
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'c1',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'a',
          },
          {
            clusterId: 'c2',
            verdict: 'UNRELATED',
            starred: false,
            rationale: 'b',
          },
          {
            clusterId: 'ghost',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'c',
          },
        ],
      }),
      params
    )
    expect(res.status).toBe(422)
    expect(mockConfirmStageRecord).not.toHaveBeenCalled()
  })

  it('409 when the run is not parked at ALIGNMENT_READY', async () => {
    mockFindById.mockResolvedValue(alignReadyRun({ stage: 'GENERATING' }))
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'c1',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'a',
          },
          {
            clusterId: 'c2',
            verdict: 'UNRELATED',
            starred: false,
            rationale: 'b',
          },
          {
            clusterId: 'c3',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'c',
          },
        ],
      }),
      params
    )
    expect(res.status).toBe(409)
    expect(mockConfirmStageRecord).not.toHaveBeenCalled()
  })

  it('404 when the run does not exist', async () => {
    mockFindById.mockResolvedValue(null)
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'c1',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'a',
          },
        ],
      }),
      params
    )
    expect(res.status).toBe(404)
  })

  it('401 when unauthenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await POST(req({ clusters: [] }), params)
    expect(res.status).toBe(401)
  })
})

// ── render source ───────────────────────────────────────────────────────────

describe('GET /api/plan-runs/[runId]/gate/align — render source', () => {
  it('returns the per-cluster align verdicts for the board', async () => {
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.stage).toBe('ALIGNMENT_READY')
    expect(json.clusters).toEqual([
      {
        clusterId: 'c1',
        verdict: 'ALIGNED',
        rationale: 'serves priority',
        customizationTrap: false,
      },
      {
        clusterId: 'c2',
        verdict: 'UNRELATED',
        rationale: 'park it',
        customizationTrap: true,
      },
      {
        clusterId: 'c3',
        verdict: 'ALIGNED',
        rationale: 'also on-priority',
        customizationTrap: false,
      },
    ])
  })

  it('409 when the run is not at ALIGNMENT_READY', async () => {
    mockFindById.mockResolvedValue(alignReadyRun({ stage: 'CLUSTERING' }))
    const res = await GET(req(), params)
    expect(res.status).toBe(409)
  })
})
