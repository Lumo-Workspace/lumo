jest.mock('@/lib/api-client/base', () => ({ apiFetch: jest.fn() }))

import { apiFetch } from '@/lib/api-client/base'
import { tasksClient } from '@/lib/api-client/tasks'

const mockFetch = apiFetch as jest.Mock

beforeEach(() => jest.clearAllMocks())

// LUM-789: confirming the acceptance contract — a plain POST, no body, to
// the per-task confirm route. Never changes task status.
describe('tasksClient.confirmCriteria', () => {
  it('POSTs to /api/tasks/:id/criteria/confirm with no body', () => {
    tasksClient.confirmCriteria('t1')
    expect(mockFetch).toHaveBeenCalledWith('/api/tasks/t1/criteria/confirm', {
      method: 'POST',
    })
  })
})
