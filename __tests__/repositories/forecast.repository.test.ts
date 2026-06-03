/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { forecastRepository } from '@/lib/repositories/forecast.repository'

const findUnique = prisma.task.findUnique as jest.Mock
const findMany = prisma.task.findMany as jest.Mock

beforeEach(() => {
  findUnique.mockReset()
  findMany.mockReset()
})

describe('loadForecastInputs', () => {
  it('returns null when the target task is missing', async () => {
    findUnique.mockResolvedValue(null)
    expect(await forecastRepository.loadForecastInputs('nope')).toBeNull()
    expect(findMany).not.toHaveBeenCalled()
  })

  it('maps target + candidates into the domain shape', async () => {
    findUnique.mockResolvedValue({
      id: 't1',
      title: 'Target',
      projectId: 'p1',
      taskTags: [{ tag: { name: 'auth' } }],
    })
    findMany.mockResolvedValue([
      {
        id: 't2',
        title: 'Older',
        number: 42,
        team: { identifier: 'LUM' },
        taskTags: [{ tag: { name: 'auth' } }, { tag: { name: 'api' } }],
        agentRuns: [{ startedAt: new Date(0), finishedAt: new Date(1) }],
        pullRequests: [{ mergedAt: new Date(2) }],
      },
    ])

    const result = await forecastRepository.loadForecastInputs('t1')
    expect(result).not.toBeNull()
    expect(result!.target).toEqual({
      id: 't1',
      title: 'Target',
      projectId: 'p1',
      tags: ['auth'],
    })
    expect(result!.candidates).toHaveLength(1)
    expect(result!.candidates[0]).toMatchObject({
      id: 't2',
      identifier: 'LUM-42',
      tags: ['auth', 'api'],
      mergedPrAt: [new Date(2)],
    })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'p1',
          status: 'DONE',
          id: { not: 't1' },
          agentRuns: { some: {} },
        }),
      })
    )
  })
})
