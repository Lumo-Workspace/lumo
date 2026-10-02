/** @jest-environment node */
const recomputeFamily = jest.fn()
jest.mock('@/lib/services/attribution.service', () => ({
  attributionService: { recomputeFamily: (id: string) => recomputeFamily(id) },
}))
const loggerError = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: { error: (...a: unknown[]) => loggerError(...a) },
}))

import { recomputeAttributionSafely } from '@/lib/attribution/trigger'

beforeEach(() => jest.clearAllMocks())

describe('recomputeAttributionSafely', () => {
  it('calls recomputeFamily with the session id', async () => {
    recomputeFamily.mockResolvedValue({ segments: [] })
    await recomputeAttributionSafely('s-1')
    expect(recomputeFamily).toHaveBeenCalledWith('s-1')
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
