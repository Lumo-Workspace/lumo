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
import { ideaRepository } from '@/lib/repositories/idea.repository'

jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories/plan-run.repository', () => ({
  planRunRepository: {
    findById: jest.fn(),
    findStageRecord: jest.fn(),
    confirmStageRecord: jest.fn(),
    updateStage: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/idea.repository', () => ({
  ideaRepository: { findByIds: jest.fn() },
}))

const mockIdentity = requireIdentity as jest.Mock
const mockFindById = planRunRepository.findById as jest.Mock
const mockFindStageRecord = planRunRepository.findStageRecord as jest.Mock
const mockConfirmStageRecord = planRunRepository.confirmStageRecord as jest.Mock
const mockUpdateStage = planRunRepository.updateStage as jest.Mock
const mockFindIdeasByIds = ideaRepository.findByIds as jest.Mock

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
      clusterId: 'cluster-0',
      verdict: 'ALIGNED',
      rationale: 'serves priority',
      customizationTrap: false,
    },
    {
      clusterId: 'cluster-1',
      verdict: 'UNRELATED',
      rationale: 'park it',
      customizationTrap: true,
    },
    {
      clusterId: 'cluster-2',
      verdict: 'ALIGNED',
      rationale: 'also on-priority',
      customizationTrap: false,
    },
  ],
}

// The clustering gate A froze. Stage-2 mints `cluster-<i>` from each cluster's
// index here, which is what ALIGN_RAW's verdicts echo back — that positional id
// is the only link from a verdict to the cluster it judged (LUM-685).
const CLUSTER_CONFIRMED = {
  clusters: [
    { name: 'Onboarding', thrust: 'smoother first run', ideaIds: ['idea-a'] },
    {
      name: 'Billing',
      thrust: 'fewer failed charges',
      ideaIds: ['idea-b', 'idea-c'],
    },
    { name: 'Speed', thrust: 'faster sprints', ideaIds: ['idea-d'] },
  ],
  orphans: ['idea-e'],
}

/** A clustering whose last cluster holds no ideas — the empty-cluster cases. */
const CLUSTER_WITH_EMPTY_LAST = {
  ...CLUSTER_CONFIRMED,
  clusters: [
    ...CLUSTER_CONFIRMED.clusters.slice(0, 2),
    { name: 'Speed', thrust: 'faster sprints', ideaIds: [] },
  ],
}

const IDEA_ROWS = [
  { id: 'idea-a', statement: 'Idea A' },
  { id: 'idea-b', statement: 'Idea B' },
  { id: 'idea-c', statement: 'Idea C' },
  { id: 'idea-d', statement: 'Idea D' },
  { id: 'idea-e', statement: 'Idea E' },
]

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

/** The CLUSTER stage record gate A confirmed. */
function clusterRecord(confirmed: unknown = CLUSTER_CONFIRMED) {
  return {
    ...alignRecord(),
    id: 'rec-cluster',
    kind: 'CLUSTER',
    llmRawOutput: confirmed,
    humanConfirmedOutput: confirmed,
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
  // Kind-aware: gate B reads the ALIGN record for verdicts AND the CLUSTER
  // record for the identity of the cluster each verdict judges.
  mockFindStageRecord.mockImplementation(async (_id: string, kind: string) =>
    kind === 'CLUSTER' ? clusterRecord() : alignRecord()
  )
  mockFindIdeasByIds.mockResolvedValue(IDEA_ROWS)
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
            clusterId: 'cluster-0',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'serves priority',
          },
          // switch c2 UNRELATED → CONFLICT and edit its rationale
          {
            clusterId: 'cluster-1',
            verdict: 'CONFLICT',
            starred: false,
            rationale: 'pulls against priority',
          },
          {
            clusterId: 'cluster-2',
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
        clusterId: 'cluster-0',
        verdict: 'ALIGNED',
        starred: true,
        rationale: 'serves priority',
        customizationTrap: false,
        ideaIds: ['idea-a'],
      },
      {
        clusterId: 'cluster-1',
        verdict: 'CONFLICT',
        starred: false,
        rationale: 'pulls against priority',
        customizationTrap: true,
        ideaIds: ['idea-b', 'idea-c'],
      },
      {
        clusterId: 'cluster-2',
        verdict: 'ALIGNED',
        starred: true,
        rationale: 'also on-priority',
        customizationTrap: false,
        ideaIds: ['idea-d'],
      },
    ])

    // advanced the run ALIGNMENT_READY → GENERATING
    expect(mockUpdateStage).toHaveBeenCalledWith(RUN_ID, 'GENERATING')

    const json = await res.json()
    expect(json.run.stage).toBe('GENERATING')
    // only the (≤2) starred ALIGNED clusters flow downstream to Stage 3
    expect(json.selectedClusterIds).toEqual(['cluster-0', 'cluster-2'])
  })

  it('the customization-trap flag is taken from the ALIGN record, not the request', async () => {
    await POST(
      req({
        clusters: [
          {
            clusterId: 'cluster-0',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'x',
          },
          // even if a client tried to smuggle customizationTrap, it is ignored;
          // c2's trap=true comes from the frozen ALIGN record.
          {
            clusterId: 'cluster-1',
            verdict: 'UNRELATED',
            starred: false,
            rationale: 'y',
            customizationTrap: false,
          },
          {
            clusterId: 'cluster-2',
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
        (c: { clusterId: string }) => c.clusterId === 'cluster-1'
      ).customizationTrap
    ).toBe(true)
  })

  it('passes at most 2 clusters downstream even when only ALIGNED-and-starred qualify', async () => {
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'cluster-0',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'a',
          },
          {
            clusterId: 'cluster-1',
            verdict: 'UNRELATED',
            starred: false,
            rationale: 'b',
          },
          {
            clusterId: 'cluster-2',
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
    expect(json.selectedClusterIds).toEqual(['cluster-0'])
  })
})

// ── per-idea 取舍 (LUM-688) ─────────────────────────────────────────────────

describe('POST /api/plan-runs/[runId]/gate/align — per-idea selection', () => {
  /** The three clusters, verdicts unchanged, with per-cluster idea overrides. */
  function confirmWith(ideaIdsByCluster: Record<string, string[] | undefined>) {
    return {
      clusters: [
        { clusterId: 'cluster-0', verdict: 'ALIGNED', rationale: 'a' },
        { clusterId: 'cluster-1', verdict: 'UNRELATED', rationale: 'b' },
        { clusterId: 'cluster-2', verdict: 'ALIGNED', rationale: 'c' },
      ].map(c => {
        const ideaIds = ideaIdsByCluster[c.clusterId]
        return {
          ...c,
          starred: false,
          ...(ideaIds === undefined ? {} : { ideaIds }),
        }
      }),
    }
  }

  function frozenIdeaIds(): Record<string, string[]> {
    const data = mockConfirmStageRecord.mock.calls[0][2]
    return Object.fromEntries(
      data.humanConfirmedOutput.clusters.map(
        (c: { clusterId: string; ideaIds: string[] }) => [c.clusterId, c.ideaIds]
      )
    )
  }

  it('freezes only the kept ideaIds per cluster', async () => {
    // The reviewer drops idea-c from cluster-1 — say it reads "details TBD".
    const res = await POST(
      req(
        confirmWith({
          'cluster-0': ['idea-a'],
          'cluster-1': ['idea-b'],
          'cluster-2': ['idea-d'],
        })
      ),
      params
    )
    expect(res.status).toBe(200)

    // An unchecked idea is ABSENT from the frozen set — not flagged, not kept.
    expect(frozenIdeaIds()).toEqual({
      'cluster-0': ['idea-a'],
      'cluster-1': ['idea-b'],
      'cluster-2': ['idea-d'],
    })
  })

  it('rejects an ideaId outside the cluster', async () => {
    // idea-b belongs to cluster-1; submitting it under cluster-0 would smuggle
    // it into a cluster gate A never put it in.
    const res = await POST(
      req(
        confirmWith({
          'cluster-0': ['idea-a', 'idea-b'],
          'cluster-1': ['idea-b', 'idea-c'],
          'cluster-2': ['idea-d'],
        })
      ),
      params
    )
    expect(res.status).toBe(422)
    expect(mockConfirmStageRecord).not.toHaveBeenCalled()
    expect(mockUpdateStage).not.toHaveBeenCalled()
  })

  it('rejects an orphaned ideaId — an orphan belongs to no cluster', async () => {
    const res = await POST(
      req(confirmWith({ 'cluster-0': ['idea-a', 'idea-e'] })),
      params
    )
    expect(res.status).toBe(422)
    expect(mockConfirmStageRecord).not.toHaveBeenCalled()
  })

  it('defaults to keeping every idea when ideaIds is omitted', async () => {
    // An older client that predates the checkboxes sends no ideaIds at all.
    const res = await POST(req(confirmWith({})), params)
    expect(res.status).toBe(200)

    expect(frozenIdeaIds()).toEqual({
      'cluster-0': ['idea-a'],
      'cluster-1': ['idea-b', 'idea-c'],
      'cluster-2': ['idea-d'],
    })
  })

  it('freezes kept ideas in gate-A order regardless of submitted order', async () => {
    await POST(req(confirmWith({ 'cluster-1': ['idea-c', 'idea-b'] })), params)
    expect(frozenIdeaIds()['cluster-1']).toEqual(['idea-b', 'idea-c'])
  })

  it('422 when a cluster lists the same idea twice', async () => {
    const res = await POST(
      req(confirmWith({ 'cluster-1': ['idea-b', 'idea-b'] })),
      params
    )
    expect(res.status).toBe(422)
    expect(mockConfirmStageRecord).not.toHaveBeenCalled()
  })

  it('400 when a starred cluster has every idea unchecked', async () => {
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'cluster-0',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'a',
            ideaIds: [],
          },
          {
            clusterId: 'cluster-1',
            verdict: 'UNRELATED',
            starred: false,
            rationale: 'b',
          },
          {
            clusterId: 'cluster-2',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'c',
          },
        ],
      }),
      params
    )
    // Stage 3 must never receive a "plan this now" cluster with nothing in it.
    expect(res.status).toBe(400)
    expect(mockConfirmStageRecord).not.toHaveBeenCalled()
    expect(mockUpdateStage).not.toHaveBeenCalled()
  })

  it('422 when a starred cluster holds no ideas at all', async () => {
    // The schema can't see this one: ideaIds is omitted, and the cluster is
    // empty in gate A's clustering. Only the service knows the universe.
    mockFindStageRecord.mockImplementation(async (_id: string, kind: string) =>
      kind === 'CLUSTER' ? clusterRecord(CLUSTER_WITH_EMPTY_LAST) : alignRecord()
    )
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'cluster-0',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'a',
          },
          {
            clusterId: 'cluster-1',
            verdict: 'UNRELATED',
            starred: false,
            rationale: 'b',
          },
          {
            clusterId: 'cluster-2',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'c',
          },
        ],
      }),
      params
    )
    expect(res.status).toBe(422)
    expect(mockConfirmStageRecord).not.toHaveBeenCalled()
  })

  it('confirms with empty selections when the clustering is unreadable', async () => {
    // Mirrors the GET degradation (LUM-685): an unreadable CLUSTER record must
    // not close a gate whose verdicts are perfectly readable. Nothing can be
    // starred in that state, so no unaccounted-for cluster reaches Stage 3.
    mockFindStageRecord.mockImplementation(async (_id: string, kind: string) =>
      kind === 'CLUSTER' ? null : alignRecord()
    )
    const res = await POST(req(confirmWith({})), params)
    expect(res.status).toBe(200)
    expect(frozenIdeaIds()).toEqual({
      'cluster-0': [],
      'cluster-1': [],
      'cluster-2': [],
    })
  })
})

// ── validation & guards ─────────────────────────────────────────────────────

describe('POST /api/plan-runs/[runId]/gate/align — guards', () => {
  it('400 when more than 2 clusters are starred (never advances)', async () => {
    const res = await POST(
      req({
        clusters: [
          {
            clusterId: 'cluster-0',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'a',
          },
          {
            clusterId: 'cluster-1',
            verdict: 'ALIGNED',
            starred: true,
            rationale: 'b',
          },
          {
            clusterId: 'cluster-2',
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
            clusterId: 'cluster-0',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'a',
          },
          {
            clusterId: 'cluster-1',
            verdict: 'CONFLICT',
            starred: true,
            rationale: 'b',
          },
          {
            clusterId: 'cluster-2',
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
            clusterId: 'cluster-0',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'a',
          },
          {
            clusterId: 'cluster-1',
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
            clusterId: 'cluster-0',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'a',
          },
          {
            clusterId: 'cluster-1',
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
            clusterId: 'cluster-0',
            verdict: 'ALIGNED',
            starred: false,
            rationale: 'a',
          },
          {
            clusterId: 'cluster-1',
            verdict: 'UNRELATED',
            starred: false,
            rationale: 'b',
          },
          {
            clusterId: 'cluster-2',
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
            clusterId: 'cluster-0',
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
  it('returns each verdict WITH the identity of the cluster it judges', async () => {
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.stage).toBe('ALIGNMENT_READY')
    // LUM-685: name/thrust/ideas ride along, joined from the CLUSTER record by
    // the positional id — without them a card is an anonymous verdict.
    expect(json.clusters).toEqual([
      {
        clusterId: 'cluster-0',
        verdict: 'ALIGNED',
        rationale: 'serves priority',
        customizationTrap: false,
        name: 'Onboarding',
        thrust: 'smoother first run',
        ideas: [{ id: 'idea-a', statement: 'Idea A' }],
      },
      {
        clusterId: 'cluster-1',
        verdict: 'UNRELATED',
        rationale: 'park it',
        customizationTrap: true,
        name: 'Billing',
        thrust: 'fewer failed charges',
        ideas: [
          { id: 'idea-b', statement: 'Idea B' },
          { id: 'idea-c', statement: 'Idea C' },
        ],
      },
      {
        clusterId: 'cluster-2',
        verdict: 'ALIGNED',
        rationale: 'also on-priority',
        customizationTrap: false,
        name: 'Speed',
        thrust: 'faster sprints',
        ideas: [{ id: 'idea-d', statement: 'Idea D' }],
      },
    ])
  })

  it('an empty cluster still names itself', async () => {
    mockFindStageRecord.mockImplementation(async (_id: string, kind: string) =>
      kind === 'CLUSTER' ? clusterRecord(CLUSTER_WITH_EMPTY_LAST) : alignRecord()
    )
    const res = await GET(req(), params)
    const json = await res.json()
    expect(json.clusters[2]).toMatchObject({
      clusterId: 'cluster-2',
      name: 'Speed',
      thrust: 'faster sprints',
      ideas: [],
    })
  })

  it('serves the gate with empty labels when the clustering is unreadable', async () => {
    // A missing/garbled CLUSTER record must degrade the cards' labels, never
    // drop a verdict or 500 a gate whose verdicts are perfectly readable.
    mockFindStageRecord.mockImplementation(async (_id: string, kind: string) =>
      kind === 'CLUSTER' ? null : alignRecord()
    )
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.clusters).toHaveLength(3)
    expect(json.clusters[0]).toMatchObject({
      clusterId: 'cluster-0',
      verdict: 'ALIGNED', // the verdict survives
      name: '',
      thrust: '',
      ideas: [],
    })
  })

  it('degrades a verdict whose clusterId was not one we minted', async () => {
    // The align LLM echoes the id back; a garbled echo must not resolve to the
    // WRONG cluster — it resolves to none.
    mockFindStageRecord.mockImplementation(async (_id: string, kind: string) =>
      kind === 'CLUSTER'
        ? clusterRecord()
        : alignRecord({
            priorityDeclared: true,
            clusters: [
              {
                clusterId: 'not-a-minted-id',
                verdict: 'ALIGNED',
                rationale: 'r',
                customizationTrap: false,
              },
            ],
          })
    )
    const res = await GET(req(), params)
    const json = await res.json()
    expect(json.clusters[0]).toMatchObject({ name: '', ideas: [] })
  })

  it('409 when the run is not at ALIGNMENT_READY', async () => {
    mockFindById.mockResolvedValue(alignReadyRun({ stage: 'CLUSTERING' }))
    const res = await GET(req(), params)
    expect(res.status).toBe(409)
  })
})
