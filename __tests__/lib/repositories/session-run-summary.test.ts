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
  it('queries sessions missing a run summary newest-first and returns their ids', async () => {
    findMany.mockResolvedValue([{ id: 'sess_2' }, { id: 'sess_1' }])

    const result =
      await sessionRepository.listForTaskMissingRunSummary('task_1')

    expect(result).toEqual(['sess_2', 'sess_1'])
    expect(findMany).toHaveBeenCalledWith({
      where: { taskId: 'task_1', runSummary: null, parentSessionId: null },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true },
    })
  })
})

describe('sessionRepository.listSessionIdsForTask', () => {
  it('returns ALL session ids on a task newest-first (force-regen, ignores runSummary)', async () => {
    findMany.mockResolvedValue([{ id: 'sess_2' }, { id: 'sess_1' }])

    const result = await sessionRepository.listSessionIdsForTask('task_1')

    expect(result).toEqual(['sess_2', 'sess_1'])
    expect(findMany).toHaveBeenCalledWith({
      where: { taskId: 'task_1', parentSessionId: null },
      orderBy: { lastActivityAt: 'desc' },
      select: { id: true },
    })
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
