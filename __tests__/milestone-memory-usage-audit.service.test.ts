/** @jest-environment node */

const mockListConsumerSessionIds = jest.fn()
const mockFindVotedSessionIds = jest.fn()
const mockFindSessionEdges = jest.fn()
const mockApplyUsageVote = jest.fn()
const mockApplyUnusedVote = jest.fn()
jest.mock('@/lib/repositories/milestone-memory-edge.repository', () => ({
  milestoneMemoryEdgeRepository: {
    listConsumerSessionIds: (...a: any[]) => mockListConsumerSessionIds(...a),
    findVotedSessionIds: (...a: any[]) => mockFindVotedSessionIds(...a),
    findSessionEdges: (...a: any[]) => mockFindSessionEdges(...a),
    applyUsageVote: (...a: any[]) => mockApplyUsageVote(...a),
    applyUnusedVote: (...a: any[]) => mockApplyUnusedVote(...a),
  },
}))

const mockFindContentByIds = jest.fn()
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findContentByIds: (...a: any[]) => mockFindContentByIds(...a),
  },
}))

const mockMilestoneFindById = jest.fn()
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: (...a: any[]) => mockMilestoneFindById(...a),
  },
}))
// LUM-778: the constitution is read per (project, workspace) — the audit
// resolves the milestone's project to its workspace first.
const mockFindWorkspaceId = jest.fn().mockResolvedValue({ workspaceId: 'w1' })
jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findWorkspaceId: (...a: any[]) => mockFindWorkspaceId(...a),
  },
}))

const mockListEvents = jest.fn()
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listEventsForSession: (...a: any[]) => mockListEvents(...a),
  },
}))

jest.mock('@/lib/services/session-summary/compact-events', () => ({
  compactEvents: () => ({ text: 'agent edited route.ts and ran jest' }),
}))

const mockLoadConstitutionText = jest.fn().mockResolvedValue('CLAUDE.md text')
jest.mock('@/lib/services/memory/constitution', () => ({
  loadConstitutionText: (...a: any[]) => mockLoadConstitutionText(...a),
}))

// The audit reuses the SAME judge as the task flywheel — mock the module the
// service dynamically imports so no @ai-sdk/gateway loads under jest.
const mockJudge = jest.fn()
jest.mock('@/lib/services/lineage/usage-judge', () => ({
  judgeFragmentUsage: (...a: any[]) => mockJudge(...a),
}))

import { milestoneMemoryUsageAuditService } from '@/lib/services/lineage/milestone-memory-usage-audit.service'

beforeEach(() => jest.clearAllMocks())

describe('milestoneMemoryUsageAuditService (LUM-648)', () => {
  it('audits steward sessions at milestone close and stamps used via the reused judge', async () => {
    mockMilestoneFindById.mockResolvedValue({
      id: 'ms',
      name: 'Beta milestone',
      projectId: 'p1',
    })
    // Two steward sessions consumed prior-milestone memory; s2 already voted.
    mockListConsumerSessionIds.mockResolvedValue(['s1', 's2'])
    mockFindVotedSessionIds.mockResolvedValue(new Set(['s2']))
    mockFindSessionEdges.mockImplementation((sessionId: string) =>
      sessionId === 's1'
        ? Promise.resolve([
            { memoryId: 'm1', sourceMilestoneId: 'src', used: null },
            { memoryId: 'm2', sourceMilestoneId: 'src', used: null },
            { memoryId: 'm3', sourceMilestoneId: 'src', used: null },
          ])
        : Promise.resolve([])
    )
    mockFindContentByIds.mockResolvedValue(
      new Map([
        ['m1', 'trap: X'],
        ['m2', 'convention: Y'],
        ['m3', 'decision: Z'],
      ])
    )
    mockListEvents.mockResolvedValue([{ type: 'x' }])
    // Judge: m1 used (HIGH), m2 judged-unused, m3 abstained (in neither list).
    mockJudge.mockResolvedValue({
      used: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'm1',
          evidence: 'edited',
          value: 'HIGH',
        },
      ],
      unused: [
        { fragmentType: 'MEMORY', fragmentId: 'm2', evidence: 'untouched' },
      ],
    })

    await milestoneMemoryUsageAuditService.auditForMilestoneClose('ms')

    // The already-voted session s2 is skipped — never re-judged.
    expect(mockFindSessionEdges).toHaveBeenCalledTimes(1)
    expect(mockFindSessionEdges).toHaveBeenCalledWith('s1')

    // Judge is called with the milestone name as the subject and the injected
    // memories as MEMORY fragments.
    expect(mockJudge).toHaveBeenCalledTimes(1)
    expect(mockJudge).toHaveBeenCalledWith(
      expect.objectContaining({
        taskTitle: 'Beta milestone',
        fragments: expect.arrayContaining([
          expect.objectContaining({ fragmentType: 'MEMORY', fragmentId: 'm1' }),
        ]),
        constitution: 'CLAUDE.md text',
      })
    )

    // LUM-778: the constitution is the milestone's project's own, resolved
    // through the project's workspace — never the server cwd.
    expect(mockFindWorkspaceId).toHaveBeenCalledWith('p1')
    expect(mockLoadConstitutionText).toHaveBeenCalledWith({
      projectId: 'p1',
      workspaceId: 'w1',
    })

    // used=true stamped on m1; used=false on m2; m3 left NULL (abstained).
    expect(mockApplyUsageVote).toHaveBeenCalledWith('s1', ['m1'])
    expect(mockApplyUnusedVote).toHaveBeenCalledWith('s1', ['m2'])
  })

  it('is a no-op when no steward session consumed memory', async () => {
    mockMilestoneFindById.mockResolvedValue({ id: 'ms', name: 'Empty' })
    mockListConsumerSessionIds.mockResolvedValue([])

    await milestoneMemoryUsageAuditService.auditForMilestoneClose('ms')

    expect(mockFindVotedSessionIds).not.toHaveBeenCalled()
    expect(mockJudge).not.toHaveBeenCalled()
    expect(mockApplyUsageVote).not.toHaveBeenCalled()
  })

  it('never throws when the milestone is missing', async () => {
    mockMilestoneFindById.mockResolvedValue(null)
    await expect(
      milestoneMemoryUsageAuditService.auditForMilestoneClose('gone')
    ).resolves.toBeUndefined()
    expect(mockListConsumerSessionIds).not.toHaveBeenCalled()
  })
})

describe('milestoneMemoryUsageAuditService — global memory pipeline switch (LUM-1314)', () => {
  afterEach(() => {
    delete process.env.MEMORY_PIPELINE_DISABLED
  })

  it('never calls the judge while the switch is on', async () => {
    process.env.MEMORY_PIPELINE_DISABLED = '1'
    mockMilestoneFindById.mockResolvedValue({ id: 'ms', name: 'M' })
    await milestoneMemoryUsageAuditService.auditForMilestoneClose('ms')
    expect(mockMilestoneFindById).not.toHaveBeenCalled()
    expect(mockJudge).not.toHaveBeenCalled()
  })
})
