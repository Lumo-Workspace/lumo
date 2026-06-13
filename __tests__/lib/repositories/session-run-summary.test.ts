/**
 * @jest-environment node
 */
jest.mock('@/lib/db/prisma', () => {
  const session = {
    findMany: jest.fn(),
    update: jest.fn(),
  }
  return { prisma: { session } }
})

import { prisma } from '@/lib/db/prisma'
import { sessionRepository } from '@/lib/repositories/session.repository'

const findMany = prisma.session.findMany as jest.Mock
const update = prisma.session.update as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('sessionRepository.listForTaskMissingRunSummary', () => {
  it('queries sessions missing a run summary and returns the rows', async () => {
    const rows = [
      { id: 'sess_2', events: [{ turnSummary: 'did B' }] },
      { id: 'sess_1', events: [{ turnSummary: 'did A' }] },
    ]
    findMany.mockResolvedValue(rows)

    const result =
      await sessionRepository.listForTaskMissingRunSummary('task_1')

    expect(result).toBe(rows)
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: 'task_1', runSummary: null },
      })
    )
  })

  it('selects STOP-row turn summaries newest-first', async () => {
    findMany.mockResolvedValue([])

    await sessionRepository.listForTaskMissingRunSummary('task_1')

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { lastActivityAt: 'desc' },
        select: {
          id: true,
          events: {
            where: {
              type: { in: ['STOP', 'STOP_FAILURE'] },
              turnSummary: { not: null },
            },
            orderBy: { createdAt: 'asc' },
            select: { turnSummary: true },
          },
        },
      })
    )
  })
})

describe('sessionRepository.setRunSummary', () => {
  it('updates runSummary + runSummaryGeneratedAt and selects only id', async () => {
    const at = new Date('2026-06-12T10:00:00Z')
    update.mockResolvedValue({ id: 'sess_1' })

    const result = await sessionRepository.setRunSummary(
      'sess_1',
      'a one-paragraph summary',
      at
    )

    expect(result).toEqual({ id: 'sess_1' })
    expect(update).toHaveBeenCalledWith({
      where: { id: 'sess_1' },
      data: {
        runSummary: 'a one-paragraph summary',
        runSummaryGeneratedAt: at,
      },
      select: { id: true },
    })
  })
})
