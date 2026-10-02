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
import { POST as postUserPrompt } from '@/app/api/hooks/user-prompt-submit/route'

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
      attributionSignals: expect.any(Array),
    })
  })

  it('parses the X-Lumo-Agent header and forwards agent to the service', async () => {
    const payload = { session_id: 'sess_1', tool_name: 'Read' }
    await postPre(
      post('http://x/api/hooks/pre-tool-use', payload, {
        Authorization: 'Bearer lum_ok',
        'X-Lumo-Agent': 'CODEX',
      })
    )
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'CODEX' })
    )
  })

  it('ignores an unknown X-Lumo-Agent value (no agent forwarded)', async () => {
    await postPre(
      post(
        'http://x/api/hooks/pre-tool-use',
        { tool_name: 'Read' },
        { Authorization: 'Bearer lum_ok', 'X-Lumo-Agent': 'bogus-agent' }
      )
    )
    const arg = mockRecord.mock.calls[0][0]
    expect(arg).not.toHaveProperty('agent')
  })

  it('forwards no agent key when the X-Lumo-Agent header is absent', async () => {
    await postPre(
      post(
        'http://x/api/hooks/pre-tool-use',
        { tool_name: 'Read' },
        { Authorization: 'Bearer lum_ok' }
      )
    )
    const arg = mockRecord.mock.calls[0][0]
    expect(arg).not.toHaveProperty('agent')
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

describe('POST /api/hooks/user-prompt-submit', () => {
  it('records USER_PROMPT_SUBMIT event', async () => {
    const payload = {
      session_id: 'sess_1',
      cwd: '/tmp',
      prompt: 'hello',
    }
    const res = await postUserPrompt(
      post('http://x/api/hooks/user-prompt-submit', payload, {
        Authorization: 'Bearer lum_ok',
      })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(mockRecord).toHaveBeenCalledWith({
      identity,
      type: 'USER_PROMPT_SUBMIT',
      payload,
      attributionSignals: expect.any(Array),
    })
  })

  it('returns 401 without bearer', async () => {
    const res = await postUserPrompt(
      post('http://x/api/hooks/user-prompt-submit', {})
    )
    expect(res.status).toBe(401)
  })
})
