import { milestoneRepository } from '@/lib/repositories/milestone.repository'

const mockFindMany = jest.fn()
jest.mock('@/lib/db/prisma', () => ({
  prisma: { milestone: { findMany: (...a: any[]) => mockFindMany(...a) } },
}))
beforeEach(() => jest.clearAllMocks())

describe('milestoneRepository.findByWorkspace', () => {
  it('scopes via project.workspaceId and excludes archived for active', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await milestoneRepository.findByWorkspace('w1', 'active')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { project: { workspaceId: 'w1' }, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      })
    )
  })
  it('includes archived when filter=all', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await milestoneRepository.findByWorkspace('w1', 'all')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { project: { workspaceId: 'w1' } } })
    )
  })
  it('only archived when filter=archived', async () => {
    mockFindMany.mockResolvedValueOnce([])
    await milestoneRepository.findByWorkspace('w1', 'archived')
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { project: { workspaceId: 'w1' }, archivedAt: { not: null } },
      })
    )
  })
})
