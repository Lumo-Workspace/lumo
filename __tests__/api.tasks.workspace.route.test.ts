/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/task-query.service', () => ({
  taskQueryService: { findForWorkspace: jest.fn() },
}))

import type { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskQueryService } from '@/lib/services/task-query.service'
import { GET } from '@/app/api/tasks/workspace/route'

const mockIdentity = requireIdentity as jest.Mock
const mockFind = taskQueryService.findForWorkspace as jest.Mock

function req(qs: string): NextRequest {
  return new Request(
    `http://localhost/api/tasks/workspace${qs}`
  ) as unknown as NextRequest
}

beforeEach(() => jest.clearAllMocks())

describe('GET /api/tasks/workspace', () => {
  it('returns viewer-scoped tasks with parsed filters', async () => {
    mockIdentity.mockResolvedValueOnce({ workspaceId: 'w1' })
    mockFind.mockResolvedValueOnce([{ id: 't1' }])

    const res = await GET(req('?statuses=TODO,DONE&projectIds=p1'))
    const body = await res.json()

    expect(mockFind).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({ statuses: ['TODO', 'DONE'], projectIds: ['p1'] })
    )
    expect(body).toEqual({ tasks: [{ id: 't1' }], truncated: false })
  })

  it('rejects an invalid status with 400 and never calls the service', async () => {
    mockIdentity.mockResolvedValueOnce({ workspaceId: 'w1' })

    const res = await GET(req('?statuses=BOGUS'))

    expect(res.status).toBe(400)
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('passes no filters through when the query string is empty', async () => {
    mockIdentity.mockResolvedValueOnce({ workspaceId: 'w1' })
    mockFind.mockResolvedValueOnce([])

    await GET(req(''))

    expect(mockFind).toHaveBeenCalledWith('w1', {})
  })
})
