/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { taskRepository } from '@/lib/repositories/task.repository'

const mockFindUnique = prisma.task.findUnique as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskRepository.findById', () => {
  it('returns task with full relations when found', async () => {
    const mockTask = {
      id: 'task-1',
      title: 'Test task',
      status: 'TODO',
      project: { id: 'proj-1', name: 'Project', workspaceId: 'ws-1' },
      team: { identifier: 'LUM' },
    }
    mockFindUnique.mockResolvedValue(mockTask)

    const result = await taskRepository.findById('task-1')

    expect(result).toEqual(mockTask)
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'task-1' } })
    )
  })

  it('returns null when task not found', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await taskRepository.findById('nonexistent')

    expect(result).toBeNull()
  })
})
