/** @jest-environment node */
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/services/session.service', () => ({
  sessionService: { bindSessionToTask: jest.fn() },
}))
jest.mock('@/lib/services/session-start-edges.service', () => ({
  sessionStartEdgesService: { collectAndRecord: jest.fn() },
}))
// LUM-686: the route composes next-step suggestions from acceptance state.
// Mocked here — this suite covers the route's own contract, not those reads.
jest.mock('@/lib/services/next-steps.service', () => ({
  nextStepsService: { forExistingTask: jest.fn().mockResolvedValue([]) },
}))
// waitUntil runs its argument synchronously so the test can observe the call.
jest.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<unknown>) => p,
}))

jest.mock('@/lib/attribution/trigger', () => ({
  recomputeAttributionSafely: jest.fn().mockResolvedValue(undefined),
}))

import * as bindRoute from '@/app/api/sessions/[sessionId]/bind-task/route'
import { recomputeAttributionSafely } from '@/lib/attribution/trigger'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'
import { sessionStartEdgesService } from '@/lib/services/session-start-edges.service'

const identity = {
  user: { id: 'user-1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key-1', name: 'laptop', prefix: 'lum_abc' },
}

const boundResult = {
  status: 'bound' as const,
  taskId: 'task-1',
  taskIdentifier: 'LUM-42',
  taskTitle: 'Test task',
  retaggedEventCount: 0,
  memorySection: '',
  criteriaSection: '',
  previousSession: null,
  blockerWarningSection: '',
}

const params = { params: Promise.resolve({ sessionId: 's-1' }) }
const req = (body: unknown) =>
  new Request('http://x/api/sessions/s-1/bind-task', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  jest.clearAllMocks()
  ;(verifyBearer as jest.Mock).mockResolvedValue(identity)
  ;(sessionService.bindSessionToTask as jest.Mock).mockResolvedValue(
    boundResult
  )
})

describe('bind-task route — lineage edge collection (LUM-528)', () => {
  it('records session-start edges via collectAndRecord after a successful bind', async () => {
    ;(sessionStartEdgesService.collectAndRecord as jest.Mock).mockResolvedValue(
      undefined
    )

    const res = await bindRoute.POST(req({ taskIdentifier: 'LUM-42' }), params)

    expect(res.status).toBe(200)
    expect(sessionStartEdgesService.collectAndRecord).toHaveBeenCalledWith({
      workspaceId: 'ws_1',
      taskId: 'task-1',
      sessionId: 's-1',
    })
  })

  it('attach succeeds and returns the bind result even when edge recording throws', async () => {
    ;(sessionStartEdgesService.collectAndRecord as jest.Mock).mockRejectedValue(
      new Error('boom')
    )
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    const res = await bindRoute.POST(req({ taskIdentifier: 'LUM-42' }), params)

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      status: 'bound',
      taskId: 'task-1',
      taskIdentifier: 'LUM-42',
    })
    errSpy.mockRestore()
  })

  it('does not record edges when bind fails (401 unauthorized)', async () => {
    ;(verifyBearer as jest.Mock).mockResolvedValue(null)

    const res = await bindRoute.POST(req({ taskIdentifier: 'LUM-42' }), params)

    expect(res.status).toBe(401)
    expect(sessionStartEdgesService.collectAndRecord).not.toHaveBeenCalled()
  })
})

describe('bind-task route — attribution recompute (LUM-932)', () => {
  it('triggers recomputeAttributionSafely after a successful bind', async () => {
    ;(sessionStartEdgesService.collectAndRecord as jest.Mock).mockResolvedValue(
      undefined
    )
    await bindRoute.POST(req({ taskIdentifier: 'LUM-42' }), params)
    expect(recomputeAttributionSafely).toHaveBeenCalledWith('s-1')
  })
})
