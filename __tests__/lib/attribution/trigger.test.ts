/** @jest-environment node */
const recomputeFamily = jest.fn()
jest.mock('@/lib/services/attribution.service', () => ({
  attributionService: { recomputeFamily: (id: string) => recomputeFamily(id) },
}))
const replay = jest.fn()
jest.mock('@/lib/services/boundary-detector-replay.service', () => ({
  replayBoundaryDetection: (...a: unknown[]) => replay(...a),
}))
const loggerError = jest.fn()
const loggerInfo = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: {
    error: (...a: unknown[]) => loggerError(...a),
    info: (...a: unknown[]) => loggerInfo(...a),
  },
}))

import { recomputeAttributionSafely } from '@/lib/attribution/trigger'

beforeEach(() => jest.clearAllMocks())

describe('recomputeAttributionSafely', () => {
  it('calls recomputeFamily with the session id', async () => {
    recomputeFamily.mockResolvedValue({
      segments: 1,
      written: true,
      eventsUpdated: 0,
      crossingsMoved: 0,
      crossingsMovedToNull: 0,
      backfilledPostToolEventIds: [],
    })
    await recomputeAttributionSafely('s-1')
    expect(recomputeFamily).toHaveBeenCalledWith('s-1')
    expect(loggerError).not.toHaveBeenCalled()
    expect(loggerInfo).not.toHaveBeenCalled()
  })

  it('logs when events were retagged or crossings moved', async () => {
    recomputeFamily.mockResolvedValue({
      segments: 1,
      written: false,
      eventsUpdated: 3,
      crossingsMoved: 1,
      crossingsMovedToNull: 1,
      backfilledPostToolEventIds: [],
    })
    await recomputeAttributionSafely('s-3')
    expect(loggerInfo).toHaveBeenCalledWith(
      'attribution recompute retagged events',
      {
        sessionId: 's-3',
        eventsUpdated: 3,
        crossingsMoved: 1,
        crossingsMovedToNull: 1,
      }
    )
    expect(replay).not.toHaveBeenCalled()
  })

  it('a missing family (null) logs nothing', async () => {
    recomputeFamily.mockResolvedValue(null)
    await recomputeAttributionSafely('s-4')
    expect(loggerInfo).not.toHaveBeenCalled()
    expect(loggerError).not.toHaveBeenCalled()
  })

  it('resolves and logs when the service rejects', async () => {
    recomputeFamily.mockRejectedValue(new Error('boom'))
    await expect(recomputeAttributionSafely('s-2')).resolves.toBeUndefined()
    expect(loggerError).toHaveBeenCalledWith(
      'attribution recompute failed',
      expect.objectContaining({ sessionId: 's-2' })
    )
  })

  it('replays the boundary detector for backfilled POST_TOOL_USE events (I1)', async () => {
    recomputeFamily.mockResolvedValue({
      segments: 1,
      written: true,
      eventsUpdated: 2,
      crossingsMoved: 0,
      crossingsMovedToNull: 0,
      backfilledPostToolEventIds: ['e1', 'e2'],
    })
    replay.mockResolvedValue({ replayed: 2, truncated: false })
    await recomputeAttributionSafely('s-5')
    expect(replay).toHaveBeenCalledWith('s-5', ['e1', 'e2'])
  })

  it('a failing replay is logged and never throws', async () => {
    recomputeFamily.mockResolvedValue({
      segments: 1,
      written: true,
      eventsUpdated: 1,
      crossingsMoved: 0,
      crossingsMovedToNull: 0,
      backfilledPostToolEventIds: ['e1'],
    })
    replay.mockRejectedValue(new Error('boom'))
    await expect(recomputeAttributionSafely('s-6')).resolves.toBeUndefined()
    expect(loggerError).toHaveBeenCalled()
  })
})
