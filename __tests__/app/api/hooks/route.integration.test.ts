/**
 * @jest-environment node
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { POST as postPre } from '@/app/api/hooks/pre-tool-use/route'
import { POST as postPost } from '@/app/api/hooks/post-tool-use/route'
import { POST as postStop } from '@/app/api/hooks/stop/route'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockRecord = hookEventService.recordHookEvent as jest.Mock

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

function post(
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue(identity)
  mockRecord.mockResolvedValue({ id: 'he_1' })
})

describe('POST /api/hooks/pre-tool-use', () => {
  it('returns 401 when Authorization header missing', async () => {
    const res = await postPre(post('http://x/api/hooks/pre-tool-use', {}))
    expect(res.status).toBe(401)
  })

  it('returns 401 when bearer token invalid', async () => {
    mockVerify.mockResolvedValue(null)
    const res = await postPre(
      post(
        'http://x/api/hooks/pre-tool-use',
        {},
        { Authorization: 'Bearer bad' }
      )
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 on malformed JSON body', async () => {
    const req = new Request('http://x/api/hooks/pre-tool-use', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer lum_ok',
      },
      body: '{not-json',
    })
    const res = await postPre(req)
    expect(res.status).toBe(400)
  })

  it('records PRE_TOOL_USE event and returns {ok:true}', async () => {
    const payload = { tool_name: 'Read', tool_input: { file_path: '/x' } }
    const res = await postPre(
      post('http://x/api/hooks/pre-tool-use', payload, {
        Authorization: 'Bearer lum_ok',
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockRecord).toHaveBeenCalledWith({
      identity,
      type: 'PRE_TOOL_USE',
      payload,
    })
  })

  it('propagates 403 when service rejects due to missing workspace membership', async () => {
    mockRecord.mockRejectedValue(
      Object.assign(
        new Error('Workspace member not found for API key holder'),
        {
          status: 403,
        }
      )
    )
    const res = await postPre(
      post(
        'http://x/api/hooks/pre-tool-use',
        { tool_name: 'Read' },
        { Authorization: 'Bearer lum_ok' }
      )
    )
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({
      error: 'Workspace member not found for API key holder',
    })
  })

  it('returns 500 on unexpected service errors', async () => {
    mockRecord.mockRejectedValue(new Error('DB down'))
    const res = await postPre(
      post(
        'http://x/api/hooks/pre-tool-use',
        { tool_name: 'Read' },
        { Authorization: 'Bearer lum_ok' }
      )
    )
    expect(res.status).toBe(500)
  })

  it('coerces unknown 4xx statuses from thrown errors to 500', async () => {
    mockRecord.mockRejectedValue(
      Object.assign(new Error('some internal lib message'), { status: 422 })
    )
    const res = await postPre(
      post(
        'http://x/api/hooks/pre-tool-use',
        {},
        { Authorization: 'Bearer lum_ok' }
      )
    )
    expect(res.status).toBe(500)
  })
})

describe('POST /api/hooks/post-tool-use', () => {
  it('records POST_TOOL_USE event', async () => {
    const res = await postPost(
      post(
        'http://x/api/hooks/post-tool-use',
        { tool_name: 'Edit' },
        { Authorization: 'Bearer lum_ok' }
      )
    )
    expect(res.status).toBe(200)
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'POST_TOOL_USE' })
    )
  })
})

describe('POST /api/hooks/stop', () => {
  it('records STOP event', async () => {
    const res = await postStop(
      post(
        'http://x/api/hooks/stop',
        { stop_reason: 'user' },
        { Authorization: 'Bearer lum_ok' }
      )
    )
    expect(res.status).toBe(200)
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'STOP' })
    )
  })
})
