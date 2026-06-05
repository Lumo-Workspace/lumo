jest.mock('@/lib/api-client/base', () => ({ apiFetch: jest.fn() }))

import { apiFetch } from '@/lib/api-client/base'
import { tasksClient } from '@/lib/api-client/tasks'

const mockFetch = apiFetch as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('tasksClient.listWorkspace', () => {
  it('comma-joins array filters into the query string', () => {
    tasksClient.listWorkspace({ projectIds: ['p1', 'p2'], statuses: ['TODO'] })
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/tasks/workspace?projectIds=p1%2Cp2&statuses=TODO'
    )
  })

  it('omits the query string entirely when no filters are given', () => {
    tasksClient.listWorkspace()
    expect(mockFetch).toHaveBeenCalledWith('/api/tasks/workspace')
  })
})
