/**
 * @jest-environment node
 *
 * LUM-1020 — shared node-redis client: one client per URL, fail-fast offline
 * mode, connect errors logged (not thrown) and the dead client rebuilt,
 * bounded wait for the first connect only, old client released on URL change.
 */
const mockConnect = jest.fn()
const mockDisconnect = jest.fn()
const mockOn = jest.fn()
const mockCreateClient = jest.fn<
  {
    connect: jest.Mock
    disconnect: jest.Mock
    on: jest.Mock
    eval: jest.Mock
  },
  [unknown]
>(() => ({
  connect: mockConnect,
  disconnect: mockDisconnect,
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
  mockDisconnect.mockResolvedValue(undefined)
})

async function settled(p: Promise<unknown>): Promise<boolean> {
  let done = false
  void p.then(() => {
    done = true
  })
  await Promise.resolve()
  await Promise.resolve()
  return done
}

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

  it('logs (does not throw) when the initial connect fails, then rebuilds the client', async () => {
    mockConnect.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(
      getSharedRedisClient('redis://down:6379')
    ).resolves.toBeDefined()
    expect(String((logger.warn as jest.Mock).mock.calls[0][0])).toContain(
      'ECONNREFUSED'
    )
    await getSharedRedisClient('redis://down:6379')
    expect(mockCreateClient).toHaveBeenCalledTimes(2)
    expect(mockConnect).toHaveBeenCalledTimes(2)
  })

  it('waits at most 2s for a hanging first connect, and later calls do not wait', async () => {
    jest.useFakeTimers()
    try {
      mockConnect.mockReturnValue(new Promise(() => {}))
      const first = getSharedRedisClient('redis://slow:6379')
      await jest.advanceTimersByTimeAsync(1_999)
      expect(await settled(first)).toBe(false)
      await jest.advanceTimersByTimeAsync(1)
      await expect(first).resolves.toBeDefined()

      const second = getSharedRedisClient('redis://slow:6379')
      expect(await settled(second)).toBe(true)
      expect(mockCreateClient).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('disconnects the old client when REDIS_URL changes', async () => {
    await getSharedRedisClient('redis://a:6379')
    await getSharedRedisClient('redis://b:6379')
    expect(mockDisconnect).toHaveBeenCalledTimes(1)
    expect(mockCreateClient).toHaveBeenCalledTimes(2)
    expect(mockCreateClient).toHaveBeenLastCalledWith(
      expect.objectContaining({ url: 'redis://b:6379' })
    )
  })
})
