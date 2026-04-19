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

// ─── findBySprint ─────────────────────────────────────────────────────────────

describe('taskRepository.findBySprint', () => {
  it('filters tasks by sprintId', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await taskRepository.findBySprint('sprint-1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sprintId: 'sprint-1' } })
    )
  })

  it('returns tasks from any project (no projectId constraint)', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await taskRepository.findBySprint('sprint-42')
    const [call] = mockFindMany.mock.calls
    expect(Object.keys(call[0].where)).not.toContain('projectId')
  })
})

// ─── findByTeamWithDetails ────────────────────────────────────────────────────

describe('taskRepository.findByTeamWithDetails — sprintId filter', () => {
  it('omits sprintId from where clause when not provided', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await taskRepository.findByTeamWithDetails('team-1')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { teamId: 'team-1' } })
    )
    const [call] = mockFindMany.mock.calls
    expect(Object.keys(call[0].where)).not.toContain('sprintId')
  })

  it('filters by sprintId string when provided', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await taskRepository.findByTeamWithDetails('team-1', 'sprint-99')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId: 'team-1', sprintId: 'sprint-99' },
      })
    )
  })

  it('filters sprintId IS NULL (backlog) when null is passed', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await taskRepository.findByTeamWithDetails('team-1', null)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId: 'team-1', sprintId: null },
      })
    )
  })
})
