/**
 * LUM-497 — service orchestration.
 *
 * The anchor is an enhancement to an existing nudge; it must never be able to
 * break or delay it. Every failure path returns '' and the caller renders the
 * nudge unchanged.
 */
jest.mock('@/lib/repositories/reference-class.repository', () => ({
  referenceClassRepository: {
    taskScope: jest.fn(),
    deliveredByMilestone: jest.fn(),
    deliveredByProject: jest.fn(),
    deliveredByTeam: jest.fn(),
    rejectionRows: jest.fn(),
    crossingRows: jest.fn(),
    latestSnapshots: jest.fn(),
    criterionChanges: jest.fn(),
  },
}))

import { referenceClassRepository } from '@/lib/repositories/reference-class.repository'
import { referenceClassService } from '@/lib/services/reference-class.service'

const repo = referenceClassRepository as unknown as {
  taskScope: jest.Mock
  deliveredByMilestone: jest.Mock
  deliveredByProject: jest.Mock
  deliveredByTeam: jest.Mock
  rejectionRows: jest.Mock
  crossingRows: jest.Mock
  latestSnapshots: jest.Mock
  criterionChanges: jest.Mock
}

function deliveries(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    taskId: `t${i}`,
    frozenAt: new Date(Date.UTC(2026, 0, 1) - i * 86_400_000),
  }))
}

beforeEach(() => {
  jest.clearAllMocks()
  repo.taskScope.mockResolvedValue({
    milestoneId: 'm1',
    milestoneName: 'Trust and cognitive load',
    projectId: 'p1',
    projectName: 'Lumo',
    teamId: 'team1',
    teamName: 'Core',
  })
  repo.deliveredByMilestone.mockResolvedValue(deliveries(10))
  repo.deliveredByProject.mockResolvedValue([])
  repo.deliveredByTeam.mockResolvedValue([])
  repo.rejectionRows.mockResolvedValue([
    { taskId: 't1', rejectionReasonEnum: 'EVIDENCE_INSUFFICIENT' },
    { taskId: 't2', rejectionReasonEnum: 'EVIDENCE_INSUFFICIENT' },
  ])
  repo.crossingRows.mockResolvedValue([])
  repo.latestSnapshots.mockResolvedValue([])
  repo.criterionChanges.mockResolvedValue([])
})

describe('buildAnchor', () => {
  it('renders the anchor for a qualifying class', async () => {
    const out = await referenceClassService.buildAnchor('current')
    expect(out).toContain('Reference class (outside view)')
    expect(out).toContain('10 delivered tasks')
    expect(out).toContain('evidence insufficient 2/10')
  })

  it('returns an empty string when a repository read throws', async () => {
    repo.rejectionRows.mockRejectedValue(new Error('db down'))
    await expect(referenceClassService.buildAnchor('current')).resolves.toBe('')
  })

  it('returns an empty string when the task cannot be resolved', async () => {
    repo.taskScope.mockResolvedValue(null)
    await expect(referenceClassService.buildAnchor('gone')).resolves.toBe('')
  })

  it('renders the insufficient-sample block when no layer qualifies', async () => {
    repo.deliveredByMilestone.mockResolvedValue(deliveries(2))
    const out = await referenceClassService.buildAnchor('current')
    expect(out).toContain('Insufficient sample')
  })

  it('skips the follow-up reads entirely when no layer qualifies', async () => {
    repo.deliveredByMilestone.mockResolvedValue(deliveries(2))
    await referenceClassService.buildAnchor('current')
    expect(repo.rejectionRows).not.toHaveBeenCalled()
    expect(repo.crossingRows).not.toHaveBeenCalled()
  })

  it('gives up and returns empty when the reads exceed the time budget', async () => {
    repo.rejectionRows.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve([]), 10_000))
    )
    const promise = referenceClassService.buildAnchor('current', {
      timeoutMs: 50,
    })
    await expect(promise).resolves.toBe('')
  }, 10_000)
})
