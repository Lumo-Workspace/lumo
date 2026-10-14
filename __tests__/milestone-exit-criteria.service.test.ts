/**
 * LUM-643: milestone exit-criteria service — steward drafting/adjudication
 * provenance (LUM-640 session attribution) and the referent-grounding gate
 * reused from LUM-602/605 (MET + EXTERNAL_FACT requires evidence, MET +
 * PENDING_OUTCOME never accepted — both 422).
 */
const mockProjectGet = jest.fn()
const mockRepoFindById = jest.fn()
const mockCritCreateMany = jest.fn()
const mockCritListByMilestone = jest.fn()
const mockCritFindById = jest.fn()
const mockCritSetVerdict = jest.fn()
const mockCritSoftDelete = jest.fn()
const mockCritDelete = jest.fn()

jest.mock('@/lib/services/project.service', () => ({
  projectService: { getProject: (...a: unknown[]) => mockProjectGet(...a) },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: (...a: unknown[]) => mockRepoFindById(...a),
  },
}))
jest.mock('@/lib/repositories/milestone-exit-criterion.repository', () => ({
  milestoneExitCriterionRepository: {
    createMany: (...a: unknown[]) => mockCritCreateMany(...a),
    listByMilestone: (...a: unknown[]) => mockCritListByMilestone(...a),
    findById: (...a: unknown[]) => mockCritFindById(...a),
    setVerdict: (...a: unknown[]) => mockCritSetVerdict(...a),
    softDelete: (...a: unknown[]) => mockCritSoftDelete(...a),
    delete: (...a: unknown[]) => mockCritDelete(...a),
  },
}))

import { milestoneExitCriteriaService } from '@/lib/services/milestone-exit-criteria.service'

function milestoneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'm-1',
    projectId: 'p-1',
    completedAt: null,
    archivedAt: null,
    ...overrides,
  }
}

function criterionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    milestoneId: 'm-1',
    statement: 'Prod deploy carries every LUM-64x migration',
    referentKind: 'AGENT_CONSTRUCTED_STATE',
    source: 'AGENT_DRAFT',
    sourceSessionId: null,
    verdict: null,
    verdictNote: null,
    verdictEvidence: null,
    verdictByMemberId: null,
    verdictSessionId: null,
    verdictAt: null,
    deletedAt: null,
    ...overrides,
  }
}

const stewardAttribution = {
  actorMemberId: 'mem-steward',
  sourceSessionId: 'cc-session-steward-1',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockProjectGet.mockResolvedValue({ id: 'p-1' })
  mockRepoFindById.mockResolvedValue(milestoneRow())
  mockCritCreateMany.mockResolvedValue({ count: 1 })
  mockCritListByMilestone.mockResolvedValue([])
  mockCritSetVerdict.mockImplementation(async (_id, input) => ({
    ...criterionRow(),
    ...input,
  }))
})

describe('milestoneExitCriteriaService (LUM-643)', () => {
  it('steward session drafts and adjudicates exit criteria with session provenance', async () => {
    // Draft: the steward's governance session id lands on every created row,
    // with the AGENT_DRAFT source.
    // LUM-1135: a milestone that already has a contract may still replace it.
    mockCritListByMilestone.mockResolvedValueOnce([criterionRow()])
    await milestoneExitCriteriaService.setCriteria(
      'm-1',
      {
        source: 'AGENT_DRAFT',
        criteria: [
          {
            statement: 'Prod deploy carries every LUM-64x migration',
            referentKind: 'AGENT_CONSTRUCTED_STATE',
          },
        ],
      },
      stewardAttribution
    )
    expect(mockCritCreateMany).toHaveBeenCalledWith([
      {
        milestoneId: 'm-1',
        statement: 'Prod deploy carries every LUM-64x migration',
        referentKind: 'AGENT_CONSTRUCTED_STATE',
        source: 'AGENT_DRAFT',
        sourceSessionId: 'cc-session-steward-1',
      },
    ])

    // Adjudication: the verdict stamps who (memberId), when, and the
    // steward session it came from.
    mockCritFindById.mockResolvedValue(criterionRow())
    const { criterion } = await milestoneExitCriteriaService.adjudicate(
      'm-1',
      'c-1',
      { verdict: 'MET', note: 'verified against prod migrate status' },
      stewardAttribution
    )
    expect(mockCritSetVerdict).toHaveBeenCalledWith('c-1', {
      verdict: 'MET',
      verdictNote: 'verified against prod migrate status',
      verdictEvidence: null,
      verdictByMemberId: 'mem-steward',
      verdictSessionId: 'cc-session-steward-1',
      verdictAt: expect.any(Date),
    })
    expect(criterion.verdict).toBe('MET')

    // Replace semantics: an adjudicated row is tombstoned (trail survives),
    // a verdict-free row is hard-deleted.
    mockCritListByMilestone.mockResolvedValueOnce([
      criterionRow({ id: 'c-old-met', verdict: 'MET' }),
      criterionRow({ id: 'c-old-pending' }),
    ])
    await milestoneExitCriteriaService.setCriteria(
      'm-1',
      {
        source: 'AGENT_DRAFT',
        criteria: [
          { statement: 'fresh contract', referentKind: 'EXTERNAL_FACT' },
        ],
      },
      stewardAttribution
    )
    expect(mockCritSoftDelete).toHaveBeenCalledWith('c-old-met')
    expect(mockCritDelete).toHaveBeenCalledWith('c-old-pending')

    // The contract locks once the milestone completes (LUM-714: that is the
    // completedAt stamp, not a status).
    mockRepoFindById.mockResolvedValue(
      milestoneRow({ completedAt: new Date('2026-06-01') })
    )
    await expect(
      milestoneExitCriteriaService.setCriteria(
        'm-1',
        { source: 'AGENT_DRAFT', criteria: [] },
        stewardAttribution
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it('refuses a brand-new contract with 410 and points to milestone testcase', async () => {
    mockCritListByMilestone.mockResolvedValue([])
    await expect(
      milestoneExitCriteriaService.setCriteria(
        'm-1',
        {
          source: 'AGENT_DRAFT',
          criteria: [{ statement: 's', referentKind: 'EXTERNAL_FACT' }],
        },
        stewardAttribution
      )
    ).rejects.toMatchObject({
      status: 410,
      message: expect.stringContaining('lumo milestone testcase add'),
    })
    expect(mockCritCreateMany).not.toHaveBeenCalled()
  })

  it('MET verdict on EXTERNAL_FACT criterion without evidence is rejected with 422', async () => {
    mockCritFindById.mockResolvedValue(
      criterionRow({ referentKind: 'EXTERNAL_FACT' })
    )

    // No evidence pointer → 422, nothing stamped: an EXTERNAL_FACT green
    // must be anchored on the fact it was read from.
    await expect(
      milestoneExitCriteriaService.adjudicate(
        'm-1',
        'c-1',
        { verdict: 'MET' },
        stewardAttribution
      )
    ).rejects.toMatchObject({ status: 422 })
    expect(mockCritSetVerdict).not.toHaveBeenCalled()

    // With evidence the same verdict lands.
    await milestoneExitCriteriaService.adjudicate(
      'm-1',
      'c-1',
      { verdict: 'MET', evidence: 'prisma migrate status @ prod 2026-07-02' },
      stewardAttribution
    )
    expect(mockCritSetVerdict).toHaveBeenCalledWith(
      'c-1',
      expect.objectContaining({
        verdict: 'MET',
        verdictEvidence: 'prisma migrate status @ prod 2026-07-02',
      })
    )

    // NOT_MET never needs evidence — the gate only guards the green.
    mockCritSetVerdict.mockClear()
    await milestoneExitCriteriaService.adjudicate(
      'm-1',
      'c-1',
      { verdict: 'NOT_MET', note: 'migration missing on prod' },
      stewardAttribution
    )
    expect(mockCritSetVerdict).toHaveBeenCalled()

    // PENDING_OUTCOME can never be adjudicated MET — truth lands post-hoc.
    mockCritSetVerdict.mockClear()
    mockCritFindById.mockResolvedValue(
      criterionRow({ referentKind: 'PENDING_OUTCOME' })
    )
    await expect(
      milestoneExitCriteriaService.adjudicate(
        'm-1',
        'c-1',
        { verdict: 'MET', evidence: 'irrelevant' },
        stewardAttribution
      )
    ).rejects.toMatchObject({ status: 422 })
    expect(mockCritSetVerdict).not.toHaveBeenCalled()

    // Tombstoned / foreign criteria are 404s, not silent writes.
    mockCritFindById.mockResolvedValue(
      criterionRow({ deletedAt: new Date('2026-07-01') })
    )
    await expect(
      milestoneExitCriteriaService.adjudicate(
        'm-1',
        'c-1',
        { verdict: 'NOT_MET' },
        stewardAttribution
      )
    ).rejects.toMatchObject({ status: 404 })
  })
})
