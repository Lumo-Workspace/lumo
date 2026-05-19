/**
 * @jest-environment node
 */
jest.mock('@/lib/auth/bearer', () => ({
  verifyBearer: jest.fn(),
}))
jest.mock('@/lib/services/task-cli.service', () => ({
  taskCliService: { updateFromCli: jest.fn() },
}))

import { verifyBearer } from '@/lib/auth/bearer'
import { taskCliService } from '@/lib/services/task-cli.service'
import { PATCH } from '@/app/api/tasks/by-identifier/[identifier]/route'

const mockVerify = verifyBearer as jest.Mock
const mockUpdate = taskCliService.updateFromCli as jest.Mock

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://x/api/tasks/by-identifier/LUM-48', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function ctx(identifier: string) {
  return { params: Promise.resolve({ identifier }) }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue(identity)
})

describe('PATCH /api/tasks/by-identifier/[identifier]', () => {
  it('returns 401 when bearer is missing', async () => {
    mockVerify.mockResolvedValueOnce(null)
    const res = await PATCH(req({ title: 'x' }), ctx('LUM-48'))
    expect(res.status).toBe(401)
  })

  it('returns 400 on malformed JSON', async () => {
    const res = await PATCH(
      req('not-json', { Authorization: 'Bearer t' }),
      ctx('LUM-48')
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when no update fields are present', async () => {
    const res = await PATCH(
      req({}, { Authorization: 'Bearer t' }),
      ctx('LUM-48')
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/at least one/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid status enum', async () => {
    const res = await PATCH(
      req({ status: 'DEFERRED' }, { Authorization: 'Bearer t' }),
      ctx('LUM-48')
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when the service throws status 404', async () => {
    mockUpdate.mockRejectedValueOnce(
      Object.assign(new Error('Task LUM-999 not found'), { status: 404 })
    )
    const res = await PATCH(
      req({ title: 'x' }, { Authorization: 'Bearer t' }),
      ctx('LUM-999')
    )
    expect(res.status).toBe(404)
  })

  it('returns 200 + task shape on success', async () => {
    mockUpdate.mockResolvedValueOnce({
      id: 'task_1',
      identifier: 'LUM-48',
      title: 'New title',
      url: 'https://www.uselumo.ai/workspace/ws/my-tasks/LUM-48',
    })
    const res = await PATCH(
      req({ title: 'New title' }, { Authorization: 'Bearer t' }),
      ctx('LUM-48')
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.task.identifier).toBe('LUM-48')
    expect(mockUpdate).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      callerClerkId: 'clerk_1',
      identifier: 'LUM-48',
      input: { title: 'New title' },
    })
  })
})
