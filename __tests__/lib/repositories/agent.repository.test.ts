/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    agentRun: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    task: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { agentRepository } from '@/lib/repositories/agent.repository'

const mockFindFirst = prisma.agentRun.findFirst as jest.Mock
const mockUpdate = prisma.agentRun.update as jest.Mock
const mockTaskFindMany = prisma.task.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('agentRepository.findActiveRun', () => {
  it('returns the active run for a task', async () => {
    const mockRun = { id: 'run-1', sandboxId: 'sb-123' }
    mockFindFirst.mockResolvedValue(mockRun)

    const result = await agentRepository.findActiveRun('task-1')

    expect(result).toEqual(mockRun)
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { taskId: 'task-1', status: 'WORKING' },
      select: { id: true, sandboxId: true },
    })
  })

  it('returns null when no active run exists', async () => {
    mockFindFirst.mockResolvedValue(null)

    const result = await agentRepository.findActiveRun('task-1')

    expect(result).toBeNull()
  })
})

describe('agentRepository.cancelRun', () => {
  it('updates run status to CANCELED with finishedAt', async () => {
    const mockUpdated = { id: 'run-1', status: 'CANCELED' }
    mockUpdate.mockResolvedValue(mockUpdated)

    const result = await agentRepository.cancelRun('run-1')

    expect(result).toEqual(mockUpdated)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: { status: 'CANCELED', finishedAt: expect.any(Date) },
    })
  })
})

describe('agentRepository.failRun', () => {
  it('updates run status to FAILED with error details', async () => {
    const mockUpdated = { id: 'run-1', status: 'FAILED' }
    mockUpdate.mockResolvedValue(mockUpdated)

    const result = await agentRepository.failRun(
      'run-1',
      'CLARIFY_TIMEOUT',
      'Timed out'
    )

    expect(result).toEqual(mockUpdated)
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      data: {
        status: 'FAILED',
        errorCode: 'CLARIFY_TIMEOUT',
        errorMessage: 'Timed out',
        finishedAt: expect.any(Date),
      },
    })
  })
})

describe('agentRepository.findTimedOutTasks', () => {
  it('returns tasks in INPUT_REQUIRED status older than 24 hours', async () => {
    const mockTasks = [
      { id: 'task-1', projectId: 'proj-1' },
      { id: 'task-2', projectId: 'proj-2' },
    ]
    mockTaskFindMany.mockResolvedValue(mockTasks)

    const result = await agentRepository.findTimedOutTasks()

    expect(result).toEqual(mockTasks)
    expect(mockTaskFindMany).toHaveBeenCalledWith({
      where: {
        agentStatus: 'INPUT_REQUIRED',
        updatedAt: { lt: expect.any(Date) },
      },
      select: { id: true, projectId: true },
    })
  })

  it('returns empty array when no timed-out tasks', async () => {
    mockTaskFindMany.mockResolvedValue([])

    const result = await agentRepository.findTimedOutTasks()

    expect(result).toEqual([])
  })
})
