/**
 * @jest-environment node
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: { getContextForIdentifier: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { taskContextService } from '@/lib/services/task-context.service'
import { GET } from '@/app/api/tasks/context/[identifier]/route'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockCtx = taskContextService.getContextForIdentifier as jest.Mock

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

function req(identifier: string, headers: Record<string, string> = {}) {
  return new Request(`http://x/api/tasks/context/${identifier}`, { headers })
}
function ctx(identifier: string) {
  return { params: Promise.resolve({ identifier }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue(identity)
})

describe('GET /api/tasks/context/[identifier]', () => {
  it('returns 401 when bearer is missing', async () => {
    // verifyBearer short-circuits before calling verifyApiKey; no mock
    // override needed. (Consuming a mockResolvedValueOnce here would
    // leak into the next test.)
    const res = await GET(req('LUM-30'), ctx('LUM-30'))
    expect(res.status).toBe(401)
  })

  it('returns 401 when the bearer token is invalid', async () => {
    mockVerify.mockResolvedValueOnce(null)
    const res = await GET(
      req('LUM-30', { Authorization: 'Bearer bad' }),
      ctx('LUM-30')
    )
    expect(res.status).toBe(401)
  })

  it('returns 404 when the task is not in the workspace', async () => {
    mockCtx.mockResolvedValueOnce(null)
    const res = await GET(
      req('LUM-30', { Authorization: 'Bearer good' }),
      ctx('LUM-30')
    )
    expect(res.status).toBe(404)
    expect(mockCtx).toHaveBeenCalledWith('ws_1', 'LUM-30')
  })

  it('returns the assembled context on hit', async () => {
    const context = { task: { identifier: 'LUM-30' }, sessions: [] }
    mockCtx.mockResolvedValueOnce(context)
    const res = await GET(
      req('LUM-30', { Authorization: 'Bearer good' }),
      ctx('LUM-30')
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(context)
  })
})
