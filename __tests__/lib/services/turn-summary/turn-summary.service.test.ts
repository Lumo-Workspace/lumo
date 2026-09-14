/**
 * @jest-environment node
 *
 * LUM-773 — after the merge, the standalone turn-summary flash call survives
 * ONLY as the summary-only path: sessions with no bound task (nothing to
 * extract memories for) and STOP_FAILURE turns. A task-bound STOP gets its
 * summary from the combined layer1 extraction instead, so the STOP route must
 * dispatch to exactly one of the two.
 */
const generateTextMock = jest.fn()
jest.mock('ai', () => ({
  generateText: (...a: unknown[]) => generateTextMock(...a),
}))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => void p,
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { listEventsForSession: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { setTurnSummary: jest.fn() },
}))
jest.mock('@/lib/services/auth.service', () => ({
  authService: { verifyApiKey: jest.fn() },
}))
jest.mock('@/lib/services/hook-event.service', () => ({
  hookEventService: { recordHookEvent: jest.fn() },
}))
jest.mock('@/lib/services/auto-block.service', () => ({
  autoBlockService: {
    onProgressRecorded: jest.fn(async () => {}),
    onFailureRecorded: jest.fn(async () => {}),
  },
}))
jest.mock('@/lib/services/memory/layer1.service', () => ({
  layer1Service: { triggerLayer1Extraction: jest.fn(async () => {}) },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { authService } from '@/lib/services/auth.service'
import { hookEventService } from '@/lib/services/hook-event.service'
import { layer1Service } from '@/lib/services/memory/layer1.service'
import { turnSummaryService } from '@/lib/services/turn-summary/turn-summary.service'
import { POST as postStop } from '@/app/api/hooks/stop/route'
import { POST as postStopFailure } from '@/app/api/hooks/stop-failure/route'

const listEvents = sessionRepository.listEventsForSession as jest.Mock
const setTurnSummary = hookEventRepository.setTurnSummary as jest.Mock
const verify = authService.verifyApiKey as jest.Mock
const record = hookEventService.recordHookEvent as jest.Mock
const layer1 = layer1Service.triggerLayer1Extraction as jest.Mock

const identity = {
  user: { id: 'clerk_1', email: 'a@b', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'k_1', name: 'laptop', prefix: 'lum_abc' },
}

function turnEvents() {
  const t0 = new Date('2026-05-04T12:00:00Z')
  return [
    {
      id: 'evt_pre',
      type: 'PRE_TOOL_USE',
      toolName: 'Bash',
      payload: { tool_input: { command: 'npm test' }, tool_use_id: 't1' },
      createdAt: t0,
    },
    {
      id: 'evt_stop',
      type: 'STOP',
      payload: { last_assistant_message: 'Tests pass.' },
      createdAt: new Date(t0.getTime() + 1000),
    },
  ]
}

function post(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer lum_ok',
    },
    body: JSON.stringify(body),
  })
}

/** Let the fire-and-forget promises the route detached settle. */
const flush = () => new Promise(r => setTimeout(r, 0))

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  verify.mockResolvedValue(identity)
  listEvents.mockResolvedValue(turnEvents())
  generateTextMock.mockResolvedValue({ text: '运行 npm test，全部通过' })
})

describe('turnSummaryService.generateAndStore — the summary-only path', () => {
  it('makes one flash call for the turn and writes the cleaned summary onto the STOP event', async () => {
    await turnSummaryService.generateAndStore({
      stopEventId: 'evt_stop',
      sessionId: 'sess_1',
    })
    expect(generateTextMock).toHaveBeenCalledTimes(1)
    expect(setTurnSummary).toHaveBeenCalledWith(
      'evt_stop',
      '运行 npm test，全部通过'
    )
  })

  it('never throws when the model call fails', async () => {
    generateTextMock.mockRejectedValue(new Error('gateway down'))
    await expect(
      turnSummaryService.generateAndStore({
        stopEventId: 'evt_stop',
        sessionId: 'sess_1',
      })
    ).resolves.toBeUndefined()
    expect(setTurnSummary).not.toHaveBeenCalled()
  })
})

describe('STOP / STOP_FAILURE routes dispatch to exactly one summary producer (LUM-773)', () => {
  it('summary-only path serves task-less sessions and STOP_FAILURE with one call', async () => {
    // Task-less STOP: no memory extraction possible → summary-only path.
    record.mockResolvedValueOnce({
      id: 'evt_stop',
      sessionId: 'sess_1',
      taskId: null,
    })
    const res = await postStop(
      post('http://x/api/hooks/stop', { session_id: 'sess_1' })
    )
    expect(res.status).toBe(200)
    await flush()
    expect(layer1).not.toHaveBeenCalled()
    expect(generateTextMock).toHaveBeenCalledTimes(1)
    expect(setTurnSummary).toHaveBeenCalledWith(
      'evt_stop',
      '运行 npm test，全部通过'
    )

    // STOP_FAILURE on a task-bound session: still summary-only, still one call.
    jest.clearAllMocks()
    verify.mockResolvedValue(identity)
    listEvents.mockResolvedValue(turnEvents())
    generateTextMock.mockResolvedValue({ text: '运行 npm test 后 API 报错' })
    record.mockResolvedValueOnce({
      id: 'evt_fail',
      sessionId: 'sess_1',
      taskId: 'task_1',
    })
    const res2 = await postStopFailure(
      post('http://x/api/hooks/stop-failure', { session_id: 'sess_1' })
    )
    expect(res2.status).toBe(200)
    await flush()
    expect(layer1).not.toHaveBeenCalled()
    expect(generateTextMock).toHaveBeenCalledTimes(1)
    expect(setTurnSummary).toHaveBeenCalledWith(
      'evt_fail',
      '运行 npm test 后 API 报错'
    )
  })

  it('a task-bound STOP goes to the combined layer1 extraction only, carrying the STOP event id', async () => {
    record.mockResolvedValueOnce({
      id: 'evt_stop',
      sessionId: 'sess_1',
      taskId: 'task_1',
    })
    const res = await postStop(
      post('http://x/api/hooks/stop', { session_id: 'sess_1' })
    )
    expect(res.status).toBe(200)
    await flush()
    expect(layer1).toHaveBeenCalledTimes(1)
    expect(layer1).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess_1',
        taskId: 'task_1',
        stopEventId: 'evt_stop',
      })
    )
    // The standalone summary call must NOT also fire — that was the 2× cost.
    expect(generateTextMock).not.toHaveBeenCalled()
  })
})
