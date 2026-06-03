const mockFindById = jest.fn()
const mockLoadInputs = jest.fn()

jest.mock('@/lib/repositories/sprint.repository', () => ({
  sprintRepository: {
    findById: (...a: unknown[]) => mockFindById(...a),
  },
}))
jest.mock('@/lib/repositories/sprint-burndown.repository', () => ({
  sprintBurndownRepository: {
    loadInputs: (...a: unknown[]) => mockLoadInputs(...a),
  },
}))

import { sprintBurndownService } from '@/lib/services/sprint-burndown.service'

beforeEach(() => {
  mockFindById.mockReset()
  mockLoadInputs.mockReset()
})

describe('sprintBurndownService.compute', () => {
  test('404 when sprint missing', async () => {
    mockFindById.mockResolvedValue(null)
    await expect(
      sprintBurndownService.compute('nope', new Date('2026-06-10T00:00:00Z'))
    ).rejects.toMatchObject({ status: 404 })
  })

  test('409 when sprint is DRAFT', async () => {
    mockFindById.mockResolvedValue({
      id: 's1',
      status: 'DRAFT',
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-03T00:00:00Z'),
    })
    await expect(
      sprintBurndownService.compute('s1', new Date('2026-06-10T00:00:00Z'))
    ).rejects.toMatchObject({ status: 409 })
  })

  test('computes series for a CLOSED sprint', async () => {
    mockFindById.mockResolvedValue({
      id: 's1',
      status: 'CLOSED',
      startDate: new Date('2026-06-01T00:00:00Z'),
      endDate: new Date('2026-06-02T00:00:00Z'),
    })
    mockLoadInputs.mockResolvedValue({
      tasks: [{ id: 't1', sprintId: 's1', status: 'DONE' }],
      activities: [
        {
          taskId: 't1',
          type: 'STATUS_CHANGED',
          payload: { from: 'TODO', to: 'DONE' },
          createdAt: new Date('2026-06-02T10:00:00Z'),
        },
      ],
    })
    const out = await sprintBurndownService.compute(
      's1',
      new Date('2026-06-10T00:00:00Z')
    )
    expect(out.sprintId).toBe('s1')
    expect(out.series.map(p => p.remaining)).toEqual([1, 0])
    expect(mockLoadInputs).toHaveBeenCalledWith('s1')
  })
})
