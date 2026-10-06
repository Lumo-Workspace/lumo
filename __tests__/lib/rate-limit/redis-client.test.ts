/**
 * @jest-environment node
 *
 * LUM-1020 — shared node-redis client: one client per URL, fail-fast offline
 * mode, connect errors logged (not thrown), bounded wait for first connect.
 */
const mockConnect = jest.fn()
const mockOn = jest.fn()
const mockCreateClient = jest.fn<
  { connect: jest.Mock; on: jest.Mock; eval: jest.Mock },
  [unknown]
>(() => ({
  connect: mockConnect,
  on: mockOn,
  eval: jest.fn(),
}))
jest.mock('redis', () => ({
  createClient: (opts: unknown) => mockCreateClient(opts),
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { logger } from '@/lib/logger'
import {
  getSharedRedisClient,
  __resetSharedRedisClientForTests,
} from '@/lib/rate-limit/redis-client'

beforeEach(() => {
  jest.clearAllMocks()
  __resetSharedRedisClientForTests()
  mockConnect.mockResolvedValue(undefined)
})

describe('getSharedRedisClient', () => {
  it('creates one fail-fast client per URL and reuses it', async () => {
    const a = await getSharedRedisClient('redis://r:6379')
    const b = await getSharedRedisClient('redis://r:6379')
    expect(a).toBe(b)
    expect(mockCreateClient).toHaveBeenCalledTimes(1)
    expect(mockCreateClient).toHaveBeenCalledWith({
      url: 'redis://r:6379',
      disableOfflineQueue: true,
    })
    expect(mockConnect).toHaveBeenCalledTimes(1)
    expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('logs (does not throw) when the initial connect fails', async () => {
    mockConnect.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(
      getSharedRedisClient('redis://down:6379')
    ).resolves.toBeDefined()
    expect(String((logger.warn as jest.Mock).mock.calls[0][0])).toContain(
      'ECONNREFUSED'
    )
  })

  it('stops waiting for a hanging connect after the bounded wait', async () => {
    jest.useFakeTimers()
    try {
      mockConnect.mockReturnValue(new Promise(() => {}))
      const p = getSharedRedisClient('redis://slow:6379')
      await jest.advanceTimersByTimeAsync(2_000)
      await expect(p).resolves.toBeDefined()
    } finally {
      jest.useRealTimers()
    }
  })
})
