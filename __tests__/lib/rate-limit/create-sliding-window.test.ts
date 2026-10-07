/**
 * @jest-environment node
 *
 * LUM-1020 — createSlidingWindow dispatches each check to the backend the
 * env selects (KV → Redis → memory) and builds each backend lazily.
 */
const mockUpstashLimit = jest.fn()
const mockRatelimitCtor = jest.fn()
jest.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    constructor(...args: unknown[]) {
      mockRatelimitCtor(...args)
    }
    limit(...args: unknown[]) {
      return mockUpstashLimit(...args)
    }
    static slidingWindow(...args: unknown[]): unknown {
      return args
    }
  },
}))
jest.mock('@vercel/kv', () => ({ kv: {} }))

const mockEval = jest.fn()
const mockGetSharedRedisClient = jest.fn<
  Promise<{ eval: jest.Mock }>,
  [string]
>(async () => ({ eval: mockEval }))
jest.mock('@/lib/rate-limit/redis-client', () => ({
  getSharedRedisClient: (url: string) => mockGetSharedRedisClient(url),
}))

import { createSlidingWindow } from '@/lib/rate-limit'

const ORIGINAL_ENV = process.env
function setEnv(vars: Record<string, string>): void {
  process.env = { ...ORIGINAL_ENV }
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  delete process.env.REDIS_URL
  Object.assign(process.env, vars)
}

const OPTS = { prefix: 'p:rate', max: 2, windowMs: 60_000 }

beforeEach(() => {
  jest.clearAllMocks()
  setEnv({})
})
afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('createSlidingWindow', () => {
  it('uses Vercel KV / Upstash with the unchanged config when KV is set', async () => {
    setEnv({ KV_REST_API_URL: 'https://x.upstash.io', KV_REST_API_TOKEN: 't' })
    mockUpstashLimit.mockResolvedValue({ success: true, remaining: 1 })
    const w = createSlidingWindow(OPTS)
    await expect(w.limit('k')).resolves.toEqual({
      success: true,
      remaining: 1,
      backend: 'kv',
    })
    expect(mockRatelimitCtor.mock.calls[0][0]).toMatchObject({
      prefix: 'p:rate',
      limiter: [2, '60 s'],
      analytics: false,
    })
    expect(mockEval).not.toHaveBeenCalled()
  })

  it('uses the shared Redis client for REDIS_URL', async () => {
    setEnv({ REDIS_URL: 'redis://cache:6379' })
    mockEval.mockResolvedValue([1, 1])
    const w = createSlidingWindow(OPTS)
    await expect(w.limit('k')).resolves.toEqual({
      success: true,
      remaining: 1,
      backend: 'redis',
    })
    expect(mockGetSharedRedisClient).toHaveBeenCalledWith('redis://cache:6379')
    expect(mockEval.mock.calls[0][1].keys).toEqual(['p:rate:k'])
    expect(mockRatelimitCtor).not.toHaveBeenCalled()
  })

  it('falls back to memory with nothing configured and never builds a remote client', async () => {
    const w = createSlidingWindow(OPTS)
    await expect(w.limit('k')).resolves.toMatchObject({
      success: true,
      backend: 'memory',
    })
    await expect(w.limit('k')).resolves.toMatchObject({ success: true })
    await expect(w.limit('k')).resolves.toMatchObject({ success: false })
    expect(mockRatelimitCtor).not.toHaveBeenCalled()
    expect(mockGetSharedRedisClient).not.toHaveBeenCalled()
  })

  it('reselects per check, and reset() clears local memory state', async () => {
    const w = createSlidingWindow(OPTS)
    await w.limit('k')
    await w.limit('k')
    await expect(w.limit('k')).resolves.toMatchObject({ success: false })

    setEnv({ REDIS_URL: 'redis://cache:6379' })
    mockEval.mockResolvedValue([1, 0])
    await expect(w.limit('k')).resolves.toMatchObject({ backend: 'redis' })

    setEnv({})
    w.reset()
    await expect(w.limit('k')).resolves.toMatchObject({
      success: true,
      backend: 'memory',
    })
  })

  it('propagates backend errors (callers choose fail-open/closed)', async () => {
    setEnv({ REDIS_URL: 'redis://cache:6379' })
    mockEval.mockRejectedValue(new Error('ClientOfflineError'))
    await expect(createSlidingWindow(OPTS).limit('k')).rejects.toThrow(
      'ClientOfflineError'
    )
  })
})
