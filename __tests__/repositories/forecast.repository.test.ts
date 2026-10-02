/** @jest-environment node */
jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn(), findMany: jest.fn() },
    // LUM-932 P3 inferred-usage query: no unattached work in these fixtures.
    hookEvent: {
      groupBy: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { forecastRepository } from '@/lib/repositories/forecast.repository'

const findUnique = prisma.task.findUnique as jest.Mock
const findMany = prisma.task.findMany as jest.Mock
const groupBy = prisma.hookEvent.groupBy as unknown as jest.Mock

beforeEach(() => {
  findUnique.mockReset()
  findMany.mockReset()
  groupBy.mockReset()
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
        sessions: [
          {
            startedAt: new Date(0),
            lastActivityAt: new Date(1),
            inputTokens: 10,
            outputTokens: 20,
            cacheReadTokens: 30,
            cacheCreationTokens: 40,
          },
        ],
        pullRequests: [{ mergedAt: new Date(2) }],
      },
    ])
    groupBy.mockResolvedValue([])

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
      runs: [{ startedAt: new Date(0), finishedAt: new Date(1) }],
      mergedPrAt: [new Date(2)],
      tokenCost: 100, // 10 + 20 + 30 + 40
    })

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          projectId: 'p1',
          status: 'DONE',
          id: { not: 't1' },
          sessions: { some: {} },
        }),
      })
    )
  })

  it('maps tokenCost to null when no session carries usage', async () => {
    findUnique.mockResolvedValue({
      id: 't1',
      title: 'Target',
      projectId: 'p1',
      taskTags: [],
    })
    findMany.mockResolvedValue([
      {
        id: 't2',
        title: 'Older',
        number: 42,
        team: { identifier: 'LUM' },
        taskTags: [],
        sessions: [
          {
            startedAt: new Date(0),
            lastActivityAt: new Date(1),
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            cacheCreationTokens: null,
          },
        ],
        pullRequests: [],
      },
    ])
    groupBy.mockResolvedValue([])

    const result = await forecastRepository.loadForecastInputs('t1')
    expect(result!.candidates[0]!.tokenCost).toBeNull()
  })

  it('interactionRounds from prompt submissions', async () => {
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
        taskTags: [{ tag: { name: 'auth' } }],
        sessions: [],
        pullRequests: [],
      },
    ])
    groupBy.mockResolvedValue([{ taskId: 't2', _count: { _all: 3 } }])

    const res = await forecastRepository.loadForecastInputs('t1')
    expect(res!.candidates[0]!.interactionRounds).toBe(3)
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['taskId'],
        where: expect.objectContaining({ type: 'USER_PROMPT_SUBMIT' }),
      })
    )
  })

  it('defaults interactionRounds to 0 when a candidate has no prompt submissions', async () => {
    findUnique.mockResolvedValue({
      id: 't1',
      title: 'Target',
      projectId: 'p1',
      taskTags: [],
    })
    findMany.mockResolvedValue([
      {
        id: 't2',
        title: 'Older',
        number: 42,
        team: { identifier: 'LUM' },
        taskTags: [],
        sessions: [],
        pullRequests: [],
      },
    ])
    groupBy.mockResolvedValue([])

    const res = await forecastRepository.loadForecastInputs('t1')
    expect(res!.candidates[0]!.interactionRounds).toBe(0)
  })
})
