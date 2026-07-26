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
    // The mock must always lose the race against the 50ms timeoutMs below, so
    // it resolves far later — but a bare setTimeout that fires after the test
    // completes leaves an open handle ("worker process failed to exit
    // gracefully"). Capture it and clear it once the race is decided; the
    // 10s duration itself is still what proves buildAnchor gave up on the
    // timeout rather than on some unrelated rejection.
    let leakedTimer: ReturnType<typeof setTimeout> | undefined
    repo.rejectionRows.mockImplementation(
      () =>
        new Promise(resolve => {
          leakedTimer = setTimeout(() => resolve([]), 10_000)
        })
    )
    try {
      await expect(
        referenceClassService.buildAnchor('current', { timeoutMs: 50 })
      ).resolves.toBe('')
    } finally {
      clearTimeout(leakedTimer)
    }
  })

  it('maps criterion-change payloads through toCriterionChange, tolerating malformed rows while still counting a genuine post-start edit', async () => {
    // Real CRITERION_CHANGED rows are freeform stored JSON — a payload can be
    // null, a bare string, or an object with the wrong shape/types if it was
    // written by an older code path. All of those must be skipped rather than
    // thrown on. Alongside them, one well-formed row must actually survive the
    // mapping and count, and one well-formed-but-round-less row must NOT
    // count — otherwise a test that only proves "garbage is skipped" would
    // pass even if the mapper dropped everything, well-formed rows included.
    const frozenAt = new Date('2026-01-01T00:00:00.000Z')
    const beforeFreeze = new Date('2025-12-15T00:00:00.000Z')

    repo.latestSnapshots.mockResolvedValue([
      { taskId: 't0', criteria: [{ id: 'c1' }], frozenAt },
      { taskId: 't1', criteria: [{ id: 'c2' }], frozenAt },
    ])

    repo.criterionChanges.mockResolvedValue([
      // null payload — skipped, no throw.
      { taskId: 't0', payload: null, createdAt: beforeFreeze },
      // non-object payload — skipped, no throw.
      { taskId: 't0', payload: 'not-json', createdAt: beforeFreeze },
      // op outside the ADDED/UPDATED/DELETED enum — skipped.
      {
        taskId: 't0',
        payload: { op: 'RENAMED', criterionId: 'c1', round: 1 },
        createdAt: beforeFreeze,
      },
      // criterionId not a string — skipped.
      {
        taskId: 't0',
        payload: { op: 'ADDED', criterionId: 42, round: 1 },
        createdAt: beforeFreeze,
      },
      // Well-formed: round > 0, criterionId 'c1' is in t0's frozen snapshot,
      // and the change lands before the freeze — this is the one row that
      // MUST survive and register as t0's post-start edit.
      {
        taskId: 't0',
        payload: { op: 'ADDED', criterionId: 'c1', round: 2 },
        createdAt: beforeFreeze,
      },
      // Well-formed but missing `round` — defaults to 0 (initial draft), so
      // it must NOT count as a post-start edit for t1.
      {
        taskId: 't1',
        payload: { op: 'ADDED', criterionId: 'c2' },
        createdAt: beforeFreeze,
      },
    ])

    const out = await referenceClassService.buildAnchor('current')

    // Only t0 qualifies. If a malformed row crashed the mapper this would
    // never render; if the missing-round row for t1 were miscounted, the
    // numerator would read 2/10 instead of 1/10.
    expect(out).toContain(
      'Contract still being written after work started: 1/10 deliveries'
    )
  })
})
