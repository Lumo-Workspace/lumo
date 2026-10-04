jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findByWorkspaceWithFilters: jest.fn() },
}))

import { taskRepository } from '@/lib/repositories/task.repository'
import { taskQueryService } from '@/lib/services/task-query.service'

const mockFind = taskRepository.findByWorkspaceWithFilters as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('taskQueryService.findForWorkspace', () => {
  it('passes the workspaceId + filters straight to the repository', async () => {
    mockFind.mockResolvedValueOnce([])
    await taskQueryService.findForWorkspace('w1', { statuses: ['TODO'] })
    expect(mockFind).toHaveBeenCalledWith('w1', { statuses: ['TODO'] })
  })

  it('shapes rows into the list view shape', async () => {
    mockFind.mockResolvedValueOnce([
      {
        id: 't1',
        title: 'A',
        team: { identifier: 'ENG' },
      },
    ])
    const result = await taskQueryService.findForWorkspace('w1', {})
    const [first] = result
    expect(first).toMatchObject({
      id: 't1',
      teamIdentifier: 'ENG',
    })
    expect(first).not.toHaveProperty('parent')
    expect(first).not.toHaveProperty('childrenDoneCount')
  })
})
