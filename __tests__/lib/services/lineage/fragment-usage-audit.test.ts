import { fragmentUsageAuditService } from '@/lib/services/lineage/fragment-usage-audit.service'

jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTask: jest.fn(),
    listEventsForSession: jest.fn(),
    findTaskTitleForSession: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    findVotedSessionIds: jest.fn(),
    findSessionFragmentEdges: jest.fn(),
    applyUsageVote: jest.fn().mockResolvedValue({ used: 1, unused: 0 }),
    applyUnusedVote: jest.fn().mockResolvedValue({ unused: 0 }),
  },
}))
jest.mock('@/lib/repositories/lineage-source.repository', () => ({
  lineageSourceRepository: { contentByType: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { getTitleAndStatus: jest.fn() },
}))
const judgeMock = jest.fn()
jest.mock('@/lib/services/lineage/usage-judge', () => ({
  judgeFragmentUsage: (...a: unknown[]) => judgeMock(...a),
}))
// LUM-778: the constitution is the task's PROJECT's own — loaded per
// (projectId, workspaceId), never from the server cwd.
const loadConstitutionTextMock = jest.fn(async () => 'CLAUDE.md text')
jest.mock('@/lib/services/memory/constitution', () => ({
  loadConstitutionText: (...a: unknown[]) =>
    loadConstitutionTextMock(...(a as [])),
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { lineageSourceRepository } from '@/lib/repositories/lineage-source.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

const ref = { fragmentType: 'MEMORY' as const, fragmentId: 'm1' }

beforeEach(() => {
  jest.clearAllMocks()
  ;(taskRepository.getTitleAndStatus as jest.Mock).mockResolvedValue({
    title: 'T',
    status: 'DONE',
    projectId: 'p1',
    project: { workspaceId: 'w1' },
  })
  ;(sessionRepository.listForTask as jest.Mock).mockResolvedValue([
    { id: 's1' },
  ])
  ;(lineageEdgeRepository.findVotedSessionIds as jest.Mock).mockResolvedValue(
    new Set()
  )
  ;(
    lineageEdgeRepository.findSessionFragmentEdges as jest.Mock
  ).mockResolvedValue([{ ...ref, used: null, usedAt: null }])
  ;(lineageSourceRepository.contentByType as jest.Mock).mockResolvedValue(
    new Map([['MEMORY::m1', 'prisma drift workaround']])
  )
  ;(sessionRepository.listEventsForSession as jest.Mock).mockResolvedValue([
    {
      id: 'e1',
      type: 'PRE_TOOL_USE',
      toolName: 'Bash',
      payload: { tool_input: { command: 'prisma db execute' } },
      createdAt: new Date(),
    },
    {
      id: 'e2',
      type: 'STOP',
      toolName: null,
      payload: {},
      createdAt: new Date(),
    },
  ])
})

describe('auditForTask', () => {
  it('votes additively on judge-confirmed fragments', async () => {
    judgeMock.mockResolvedValue({
      used: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'm1',
          evidence: 'ran db execute',
        },
      ],
      unused: [],
    })
    await fragmentUsageAuditService.auditForTask('task1')
    expect(lineageEdgeRepository.applyUsageVote).toHaveBeenCalledWith(
      's1',
      [{ fragmentType: 'MEMORY', fragmentId: 'm1' }],
      { mode: 'additive' }
    )
    // The judge's marginal-value gate compares against the task's own
    // project constitution (LUM-778).
    expect(loadConstitutionTextMock).toHaveBeenCalledWith({
      projectId: 'p1',
      workspaceId: 'w1',
    })
    expect(judgeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskTitle: 'T',
        constitution: 'CLAUDE.md text',
      })
    )
  })

  it('cron backstop resolves the constitution scope from the session task (LUM-778)', async () => {
    ;(lineageEdgeRepository.listUnvotedSessionIdsForDoneTasks as jest.Mock) =
      jest.fn().mockResolvedValue(['s9'])
    ;(sessionRepository.findTaskTitleForSession as jest.Mock).mockResolvedValue(
      { title: 'Cron task', projectId: 'p2', project: { workspaceId: 'w2' } }
    )
    judgeMock.mockResolvedValue({ used: [], unused: [] })
    await fragmentUsageAuditService.auditDoneTaskSessions(5)
    expect(loadConstitutionTextMock).toHaveBeenCalledWith({
      projectId: 'p2',
      workspaceId: 'w2',
    })
  })

  it('skips a session that already has a vote (guard)', async () => {
    ;(lineageEdgeRepository.findVotedSessionIds as jest.Mock).mockResolvedValue(
      new Set(['s1'])
    )
    await fragmentUsageAuditService.auditForTask('task1')
    expect(judgeMock).not.toHaveBeenCalled()
    expect(lineageEdgeRepository.applyUsageVote).not.toHaveBeenCalled()
  })

  it('when the judge confirms nothing, writes no vote (edges stay NULL)', async () => {
    judgeMock.mockResolvedValue({ used: [], unused: [] })
    await fragmentUsageAuditService.auditForTask('task1')
    expect(lineageEdgeRepository.applyUsageVote).not.toHaveBeenCalled()
  })

  it('never throws when a repo rejects', async () => {
    ;(sessionRepository.listForTask as jest.Mock).mockRejectedValue(
      new Error('db down')
    )
    await expect(
      fragmentUsageAuditService.auditForTask('task1')
    ).resolves.toBeUndefined()
  })

  it('calls applyUnusedVote with unused refs when judge returns non-empty unused', async () => {
    judgeMock.mockResolvedValue({
      used: [],
      unused: [
        {
          fragmentType: 'MEMORY',
          fragmentId: 'm1',
          evidence: 'no evidence found',
        },
      ],
    })
    await fragmentUsageAuditService.auditForTask('task1')
    expect(lineageEdgeRepository.applyUnusedVote).toHaveBeenCalledWith('s1', [
      { fragmentType: 'MEMORY', fragmentId: 'm1' },
    ])
    expect(lineageEdgeRepository.applyUsageVote).not.toHaveBeenCalled()
  })

  it('does not call applyUnusedVote when unused is empty', async () => {
    judgeMock.mockResolvedValue({
      used: [{ fragmentType: 'MEMORY', fragmentId: 'm1', evidence: 'used it' }],
      unused: [],
    })
    await fragmentUsageAuditService.auditForTask('task1')
    expect(lineageEdgeRepository.applyUsageVote).toHaveBeenCalledWith(
      's1',
      [{ fragmentType: 'MEMORY', fragmentId: 'm1' }],
      { mode: 'additive' }
    )
    expect(lineageEdgeRepository.applyUnusedVote).not.toHaveBeenCalled()
  })
})
