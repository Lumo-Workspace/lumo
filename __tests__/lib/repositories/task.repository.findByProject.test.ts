/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { taskRepository } from '@/lib/repositories/task.repository'

const mockFindMany = prisma.task.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskRepository.findByProjectWithDetails — sprintId filter', () => {
  it('omits sprintId from where clause when not provided', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await taskRepository.findByProjectWithDetails('proj-1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { projectId: 'proj-1' } })
    )
    // sprintId key must NOT be present in the where clause
    const [call] = mockFindMany.mock.calls
    expect(Object.keys(call[0].where)).not.toContain('sprintId')
  })

  it('filters by sprintId string when provided', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await taskRepository.findByProjectWithDetails('proj-1', 'sprint-42')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'proj-1', sprintId: 'sprint-42' },
      })
    )
  })

  it('filters sprintId IS NULL (backlog) when null is passed', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await taskRepository.findByProjectWithDetails('proj-1', null)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'proj-1', sprintId: null },
      })
    )
  })
})
