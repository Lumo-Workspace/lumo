/** @jest-environment node */
const recomputeFamily = jest.fn()
jest.mock('@/lib/services/attribution.service', () => ({
  attributionService: { recomputeFamily: (id: string) => recomputeFamily(id) },
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
    })
    await recomputeAttributionSafely('s-3')
    expect(loggerInfo).toHaveBeenCalledWith(
      'attribution recompute retagged events',
      { sessionId: 's-3', eventsUpdated: 3, crossingsMoved: 1 }
    )
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
})
