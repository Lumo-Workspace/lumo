/**
 * @jest-environment node
 *
 * LUM-932 P3 I4: on the turn an UNATTACHED session switches task, Layer-1
 * memory must go to the task the recompute attributes the STOP to, not the
 * stale record-time tag. Attached sessions are unchanged (recompute and
 * Layer 1 run side by side on the bound task).
 */
const recompute = jest.fn()
const recomputeOnly = jest.fn()
const replayBackfilled = jest.fn()
jest.mock('@/lib/attribution/trigger', () => ({
  recomputeAttributionSafely: (...a: unknown[]) => recompute(...a),
  recomputeAttributionOnly: (...a: unknown[]) => recomputeOnly(...a),
  replayBackfilledEvents: (...a: unknown[]) => replayBackfilled(...a),
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findTaskAndAttribution: jest.fn() },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { findTaskId: jest.fn() },
}))
jest.mock('@/lib/services/memory/layer1.service', () => ({
  layer1Service: { triggerLayer1Extraction: jest.fn() },
}))
jest.mock('@/lib/services/turn-summary/turn-summary.service', () => ({
  turnSummaryService: { generateAndStore: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }))

// LUM-917: the AI-derived content switch (on unless a test turns it off).
const mockAiDerivedEnabled = jest.fn()
jest.mock('@/lib/services/ai-derived-content.service', () => ({
  aiDerivedContentService: {
    isEnabled: (...args: unknown[]) => mockAiDerivedEnabled(...args),
  },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { layer1Service } from '@/lib/services/memory/layer1.service'
import { turnSummaryService } from '@/lib/services/turn-summary/turn-summary.service'
import { stopTurnService } from '@/lib/services/stop-turn.service'

const findSession = sessionRepository.findTaskAndAttribution as jest.Mock
const findTaskId = hookEventRepository.findTaskId as jest.Mock
const layer1 = layer1Service.triggerLayer1Extraction as jest.Mock
const summary = turnSummaryService.generateAndStore as jest.Mock

const ctx = (over: Record<string, unknown> = {}) => ({
  sessionId: 's1',
  taskId: 'task_old' as string | null,
  workspaceId: 'ws',
  eventId: 'evt_stop',
  ...over,
})

beforeEach(() => {
  jest.clearAllMocks()
  layer1.mockResolvedValue(undefined)
  summary.mockResolvedValue(undefined)
  mockAiDerivedEnabled.mockResolvedValue(true)
})

describe('stopTurnService.afterStop', () => {
  it('ai-derived content off: a task turn gets the summary-only call, no memory extraction (LUM-917)', async () => {
    findSession.mockResolvedValue({ taskId: 'task_old' })
    mockAiDerivedEnabled.mockResolvedValue(false)
    await stopTurnService.afterStop(ctx())
    expect(mockAiDerivedEnabled).toHaveBeenCalledWith({ workspaceId: 'ws' })
    expect(layer1).not.toHaveBeenCalled()
    expect(summary).toHaveBeenCalledWith({
      stopEventId: 'evt_stop',
      sessionId: 's1',
    })
  })

  it('unattached: awaits the recompute, then runs Layer 1 on the STOP event current task', async () => {
    const order: string[] = []
    findSession.mockResolvedValue({ taskId: null })
    recomputeOnly.mockImplementation(async () => {
      order.push('recompute')
      return { backfilledPostToolEventIds: ['e1'] }
    })
    replayBackfilled.mockImplementation(async () => {
      order.push('replay')
    })
    findTaskId.mockImplementation(async () => {
      order.push('reread')
      return 'task_new'
    })
    layer1.mockImplementation(async () => {
      order.push('layer1')
    })
    await stopTurnService.afterStop(ctx())
    expect(order).toEqual(['recompute', 'reread', 'layer1', 'replay'])
    expect(replayBackfilled).toHaveBeenCalledWith('s1', {
      backfilledPostToolEventIds: ['e1'],
    })
    expect(recompute).not.toHaveBeenCalled()
    expect(findTaskId).toHaveBeenCalledWith('evt_stop')
    expect(layer1).toHaveBeenCalledWith({
      sessionId: 's1',
      taskId: 'task_new',
      workspaceId: 'ws',
      stopEventId: 'evt_stop',
    })
    expect(summary).not.toHaveBeenCalled()
  })

  it('unattached: a STOP the recompute leaves task-less gets the summary-only call', async () => {
    findSession.mockResolvedValue({ taskId: null })
    findTaskId.mockResolvedValue(null)
    await stopTurnService.afterStop(ctx())
    expect(layer1).not.toHaveBeenCalled()
    expect(summary).toHaveBeenCalledWith({
      stopEventId: 'evt_stop',
      sessionId: 's1',
    })
  })

  it('a child session whose parent is bound counts as attached', async () => {
    findSession.mockImplementation(async (id: string) =>
      id === 's1' ? { taskId: 'task_bound' } : { taskId: null }
    )
    await stopTurnService.afterStop(
      ctx({ sessionId: 's1:a1', taskId: 'task_bound' })
    )
    expect(findTaskId).not.toHaveBeenCalled()
    expect(layer1).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_bound' })
    )
  })

  it('attached: recompute and Layer 1 on the bound task, no re-read', async () => {
    findSession.mockResolvedValue({ taskId: 'task_bound' })
    await stopTurnService.afterStop(ctx({ taskId: 'task_bound' }))
    expect(recompute).toHaveBeenCalledWith('s1')
    expect(findTaskId).not.toHaveBeenCalled()
    expect(layer1).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_bound' })
    )
  })

  it('fail-soft: a failing re-read falls back to the record-time task and never throws', async () => {
    findSession.mockResolvedValue({ taskId: null })
    findTaskId.mockRejectedValue(new Error('db down'))
    await expect(stopTurnService.afterStop(ctx())).resolves.toBeUndefined()
    expect(layer1).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task_old' })
    )
  })
})
