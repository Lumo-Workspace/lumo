// Mocks must be declared before any imports that reference the mocked modules.

const mockFindById = jest.fn()
const mockLoadInputs = jest.fn()

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    findById: (...a: unknown[]) => mockFindById(...a),
  },
}))

jest.mock('@/lib/repositories/sprint-burnup.repository', () => ({
  sprintBurnupRepository: {
    loadInputs: (...a: unknown[]) => mockLoadInputs(...a),
  },
}))

import { sprintBurnupService } from '@/lib/services/sprint-burnup.service'

beforeEach(() => jest.clearAllMocks())

describe('sprintBurnupService.compute', () => {
  test('404 when sprint not found', async () => {
    mockFindById.mockResolvedValue(null)

    await expect(
      sprintBurnupService.compute('missing-id', new Date())
    ).rejects.toMatchObject({ status: 404 })

    expect(mockFindById).toHaveBeenCalledWith('missing-id')
    expect(mockLoadInputs).not.toHaveBeenCalled()
  })

  test('409 when sprint is DRAFT', async () => {
    mockFindById.mockResolvedValue({
      id: 'draft-sprint',
      status: 'DRAFT',
      startDate: new Date('2026-06-01T00:00:00Z'),
      startedAt: null,
      endDate: new Date('2026-06-07T00:00:00Z'),
    })

    await expect(
      sprintBurnupService.compute('draft-sprint', new Date())
    ).rejects.toMatchObject({ status: 409 })

    expect(mockLoadInputs).not.toHaveBeenCalled()
  })

  test('computes series for a CLOSED sprint', async () => {
    mockFindById.mockResolvedValue({
      id: 's1',
      status: 'CLOSED',
      startDate: new Date('2026-06-01T00:00:00Z'),
      startedAt: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-02T00:00:00Z'),
    })

    mockLoadInputs.mockResolvedValue({
      tasks: [
        {
          id: 't1',
          sprintId: 's1',
          status: 'DONE',
          createdAt: new Date('2026-06-01T00:00:00Z'),
        },
      ],
      activities: [
        {
          taskId: 't1',
          type: 'STATUS_CHANGED',
          payload: { from: 'TODO', to: 'DONE' },
          createdAt: new Date('2026-06-02T10:00:00Z'),
        },
      ],
    })

    const out = await sprintBurnupService.compute(
      's1',
      new Date('2026-06-10T00:00:00Z')
    )

    expect(out.sprintId).toBe('s1')
    expect(out.scopeTotal).toBe(1)
    // t1 created 06-01 → in scope both days
    // STATUS_CHANGED to DONE at 06-02T10:00 → not done at EOD 06-01, done at EOD 06-02
    expect(out.series.map(p => p.completed)).toEqual([0, 1])
    expect(mockLoadInputs).toHaveBeenCalledWith('s1')
  })
})
