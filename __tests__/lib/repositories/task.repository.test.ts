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
const mockFindMany = prisma.task.findMany as jest.Mock

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

describe('taskRepository.isDescendant', () => {
  it('returns true when target is direct child', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 'child-1' }, { id: 'child-2' }])
    const result = await taskRepository.isDescendant('parent', 'child-2')
    expect(result).toBe(true)
  })

  it('returns true when target is nested descendant', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 'child-1' }])
    mockFindMany.mockResolvedValueOnce([{ id: 'grandchild-1' }])
    const result = await taskRepository.isDescendant('parent', 'grandchild-1')
    expect(result).toBe(true)
  })

  it('returns false when target is not a descendant', async () => {
    mockFindMany.mockResolvedValueOnce([{ id: 'child-1' }])
    mockFindMany.mockResolvedValueOnce([])
    const result = await taskRepository.isDescendant('parent', 'unrelated')
    expect(result).toBe(false)
  })

  it('returns false when parent has no children', async () => {
    mockFindMany.mockResolvedValueOnce([])
    const result = await taskRepository.isDescendant('parent', 'target')
    expect(result).toBe(false)
  })
})
