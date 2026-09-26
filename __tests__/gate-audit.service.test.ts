import { gateAuditService } from '@/lib/services/gate-audit.service'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { gateSignalRepository } from '@/lib/repositories/gate-signal.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { sessionRepository } from '@/lib/repositories/session.repository'

jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findByTaskId: jest.fn() },
}))
jest.mock('@/lib/repositories/gate-signal.repository', () => ({
  gateSignalRepository: { findByTaskId: jest.fn() },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findManyByTaskId: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findManyForAttribution: jest.fn() },
}))

const findHookRows = hookEventRepository.findByTaskId as jest.Mock
const findGateSignals = gateSignalRepository.findByTaskId as jest.Mock
const findPrs = pullRequestRepository.findManyByTaskId as jest.Mock
const findSessions = sessionRepository.findManyForAttribution as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('gateAuditService.getPerPrForTask', () => {
  it('shows the CI checks on the PR head commit and the agent runs from its session branch', async () => {
    findPrs.mockResolvedValue([
      {
        number: 12,
        title: 'feature',
        state: 'open',
        headBranch: 'lumo/LUM-1-x',
        headSha: 'abc123',
        mergedAt: null,
      },
    ])
    findGateSignals.mockResolvedValue([
      {
        outcome: 'success',
        checkName: 'Vercel',
        detailsUrl: 'https://ci/run/1',
        source: 'github_check',
        createdAt: new Date('2026-06-28T10:00:00.000Z'),
        headSha: 'abc123',
        prNumber: 12,
      },
    ])
    findHookRows.mockResolvedValue([
      {
        type: 'POST_TOOL_USE',
        payload: { tool_name: 'Bash', tool_input: { command: 'tsc --noEmit' } },
        createdAt: new Date('2026-06-27T10:00:00.000Z'),
        sessionId: 's1',
      },
    ])
    findSessions.mockResolvedValue([
      { id: 's1', worktree: { branch: 'lumo/LUM-1-x' } },
    ])

    const perPr = await gateAuditService.getPerPrForTask('task_1')

    expect(findHookRows).toHaveBeenCalledWith('task_1')
    expect(findGateSignals).toHaveBeenCalledWith('task_1')
    expect(findSessions).toHaveBeenCalledWith(['s1'])
    const audit = perPr.prs[0]!.audit
    expect(audit.headSha).toBe('abc123')
    expect(audit.ci).toEqual([
      {
        name: 'Vercel',
        status: 'passed',
        source: 'github_check',
        detailsUrl: 'https://ci/run/1',
        at: '2026-06-28T10:00:00.000Z',
      },
    ])
    expect(audit.selfReported.map(s => s.command)).toEqual(['tsc --noEmit'])
    expect(perPr.unlinked).toBeNull()
  })
})
