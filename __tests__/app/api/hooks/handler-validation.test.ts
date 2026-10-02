/**
 * @jest-environment node
 *
 * Boundary validation at the hook POST handler (LUM-348): malformed or
 * oversized payloads are sanitized (truncate/drop + mark) before persistence,
 * and never break the event stream — the response stays 200 {ok:true}.
 */
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))

import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { handleHookRequest } from '@/app/api/hooks/_handler'
import { HOOK_FREE_TEXT_CAP } from '@/lib/validation/hook-payload'
import { stripCodeFromHookPayload } from '@/lib/hook-payload/redact'
import { extractAttributionSignals } from '@/lib/attribution/signals'

const mockVerify = authService.verifyApiKey as jest.Mock
const mockRecord = hookEventService.recordHookEvent as jest.Mock

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

function post(body: unknown) {
  return new Request('http://x/api/hooks/stop', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer lum_ok',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockVerify.mockResolvedValue(identity)
  mockRecord.mockResolvedValue({
    id: 'he_1',
    sessionId: 'sess_1',
    taskId: null,
    toolName: null,
    filePath: null,
  })
})

describe('handleHookRequest payload validation', () => {
  it('records a wrong-typed key field as dropped + marked, still 200 {ok:true}', async () => {
    const res = await handleHookRequest(
      post({ session_id: 42, cwd: '/repo' }),
      'STOP'
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const recorded = mockRecord.mock.calls[0][0]
    expect(recorded.payload.session_id).toBeUndefined()
    expect(recorded.payload.cwd).toBe('/repo')
    expect(recorded.payload._lumo_validation).toEqual({
      dropped: ['session_id'],
    })
  })

  it('truncates an oversized field before persistence, still 200', async () => {
    const res = await handleHookRequest(
      post({
        session_id: 'sess_1',
        last_assistant_message: 'y'.repeat(HOOK_FREE_TEXT_CAP + 10),
      }),
      'STOP'
    )
    expect(res.status).toBe(200)
    const recorded = mockRecord.mock.calls[0][0]
    expect(recorded.payload.last_assistant_message.length).toBe(
      HOOK_FREE_TEXT_CAP
    )
    expect(recorded.payload._lumo_validation).toEqual({
      truncated: ['last_assistant_message'],
    })
  })

  it('records a non-object body as a marked empty payload, still 200', async () => {
    const res = await handleHookRequest(post(['not', 'an', 'object']), 'STOP')
    expect(res.status).toBe(200)
    const recorded = mockRecord.mock.calls[0][0]
    expect(recorded.payload).toEqual({
      _lumo_validation: { dropped: ['$root'] },
    })
  })

  it('passes a well-formed in-cap payload through unchanged', async () => {
    const payload = {
      session_id: 'sess_1',
      cwd: '/repo',
      last_assistant_message: 'done',
    }
    const res = await handleHookRequest(post(payload), 'STOP')
    expect(res.status).toBe(200)
    const recorded = mockRecord.mock.calls[0][0]
    expect(recorded.payload).toEqual(payload)
    expect(recorded.payload._lumo_validation).toBeUndefined()
  })

  it('hands the sanitized payload (not the raw body) to afterRecord', async () => {
    const afterRecord = jest.fn()
    await handleHookRequest(
      post({ session_id: 42, tool_name: 'Read' }),
      'PRE_TOOL_USE',
      { afterRecord }
    )
    const ctx = afterRecord.mock.calls[0][0]
    expect(ctx.payload.session_id).toBeUndefined()
    expect(ctx.payload.tool_name).toBe('Read')
    expect(ctx.payload._lumo_validation).toEqual({ dropped: ['session_id'] })
  })

  it('still rejects unparseable JSON with 400 (boundary unchanged)', async () => {
    const req = new Request('http://x/api/hooks/stop', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer lum_ok',
      },
      body: '{not-json',
    })
    const res = await handleHookRequest(req, 'STOP')
    expect(res.status).toBe(400)
  })
})

describe('handleHookRequest attribution signals (LUM-932 P2)', () => {
  const agentPayload = {
    session_id: 'sess_1',
    tool_name: 'Agent',
    tool_input: { prompt: 'Work on LUM-13' },
    tool_response: { agentId: 'abeaba01ea909a7ee', status: 'completed' },
  }

  it('extracts AGENT_PROMPT before code stripping erases tool_response.agentId', async () => {
    await handleHookRequest(post(agentPayload), 'POST_TOOL_USE')
    const recorded = mockRecord.mock.calls[0][0]
    expect(recorded.attributionSignals).toEqual(
      expect.arrayContaining([
        {
          kind: 'AGENT_PROMPT',
          identifier: 'LUM-13',
          agentId: 'abeaba01ea909a7ee',
        },
      ])
    )
  })

  it('documents the cause: extracting from the stripped payload loses AGENT_PROMPT', () => {
    const stripped = stripCodeFromHookPayload('POST_TOOL_USE', agentPayload)
    const signals = extractAttributionSignals('POST_TOOL_USE', stripped)
    expect(signals.some(s => s.kind === 'AGENT_PROMPT')).toBe(false)
  })
})
