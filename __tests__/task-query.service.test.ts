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
        parent: null,
        _count: { children: 2 },
        children: [{ id: 'c1' }],
      },
    ])
    const result = await taskQueryService.findForWorkspace('w1', {})
    const [first] = result
    expect(first).toMatchObject({
      id: 't1',
      teamIdentifier: 'ENG',
      parent: null,
      childrenDoneCount: 1,
    })
  })

  it('flattens a parent reference', async () => {
    mockFind.mockResolvedValueOnce([
      {
        id: 't2',
        team: { identifier: 'ENG' },
        parent: {
          id: 'p',
          title: 'Parent',
          number: 7,
          team: { identifier: 'ENG' },
        },
        _count: { children: 0 },
        children: [],
      },
    ])
    const [first] = await taskQueryService.findForWorkspace('w1', {})
    expect(first?.parent).toEqual({
      id: 'p',
      title: 'Parent',
      number: 7,
      teamIdentifier: 'ENG',
    })
  })
})
