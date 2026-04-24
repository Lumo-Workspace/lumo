/**
 * @jest-environment node
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: { resolveIdentifier: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { taskService } from '@/lib/services/task.service'
import { GET } from '@/app/api/tasks/resolve/[identifier]/route'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockResolve = taskService.resolveIdentifier as jest.Mock

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

function req(identifier: string, headers: Record<string, string> = {}) {
  return new Request(`http://x/api/tasks/resolve/${identifier}`, {
    headers,
  })
}

function ctx(identifier: string) {
  return { params: Promise.resolve({ identifier }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue(identity)
})

describe('GET /api/tasks/resolve/[identifier]', () => {
  it('returns 401 when Authorization header missing', async () => {
    const res = await GET(req('LUM-30'), ctx('LUM-30'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer key is invalid', async () => {
    mockVerify.mockResolvedValueOnce(null)
    const res = await GET(
      req('LUM-30', { Authorization: 'Bearer bad' }),
      ctx('LUM-30')
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when no task matches in the workspace', async () => {
    mockResolve.mockResolvedValueOnce(null)
    const res = await GET(
      req('LUM-30', { Authorization: 'Bearer good' }),
      ctx('LUM-30')
    )
    expect(res.status).toBe(404)
    expect(mockResolve).toHaveBeenCalledWith('ws_1', 'LUM-30')
  })

  it('returns the task descriptor on hit', async () => {
    mockResolve.mockResolvedValueOnce({
      id: 'task_cmoc',
      identifier: 'LUM-30',
      title: 'T',
      status: 'IN_PROGRESS',
    })
    const res = await GET(
      req('LUM-30', { Authorization: 'Bearer good' }),
      ctx('LUM-30')
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: 'task_cmoc',
      identifier: 'LUM-30',
      title: 'T',
      status: 'IN_PROGRESS',
    })
  })

  it('scopes the resolve to the authenticated workspace', async () => {
    mockResolve.mockResolvedValueOnce(null)
    await GET(req('LUM-30', { Authorization: 'Bearer good' }), ctx('LUM-30'))
    expect(mockResolve).toHaveBeenCalledWith('ws_1', 'LUM-30')
  })
})
