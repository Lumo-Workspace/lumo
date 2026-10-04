/**
 * @jest-environment node
 *
 * LUM-983 — the generic KV-or-memory sliding-window limiter extracted from
 * the SARIF ingest limiter. Covers: over-limit, window reset, per-limiter
 * isolation, the Upstash path (prefix + limits passed through), and
 * fail-open when the limiter backend itself errors.
 */
const mockLimit = jest.fn()
const mockRatelimitCtor = jest.fn()

jest.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    constructor(...args: unknown[]) {
      mockRatelimitCtor(...args)
    }
    limit(...args: unknown[]) {
      return mockLimit(...args)
    }
    static slidingWindow(...args: unknown[]): unknown {
      return args
    }
  },
}))
jest.mock('@vercel/kv', () => ({ kv: {} }))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { logger } from '@/lib/logger'
import { createSlidingWindowRateLimiter } from '@/lib/services/sliding-window-rate-limit'

const mockedWarn = logger.warn as jest.Mock
const ORIGINAL_ENV = process.env

function setKvEnv(configured: boolean): void {
  process.env = { ...ORIGINAL_ENV }
  if (configured) {
    process.env.KV_REST_API_URL = 'https://example-kv.upstash.io'
    process.env.KV_REST_API_TOKEN = 'test-token'
  } else {
    delete process.env.KV_REST_API_URL
    delete process.env.KV_REST_API_TOKEN
  }
}

function makeLimiter(prefix = 'test:rate') {
  return createSlidingWindowRateLimiter({
    prefix,
    max: 3,
    windowMs: 10_000,
    logTag: 'test-rate-limit',
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  setKvEnv(false)
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('createSlidingWindowRateLimiter — in-memory window', () => {
  it('allows up to max calls per key, then reports over-limit', async () => {
    const limiter = makeLimiter()
    for (let i = 0; i < 3; i++) {
      await expect(limiter.check('k')).resolves.toBe(true)
    }
    await expect(limiter.check('k')).resolves.toBe(false)
    await expect(limiter.check('other')).resolves.toBe(true)
  })

  it('allows the key again once the window has elapsed', async () => {
    const limiter = makeLimiter()
    const now = Date.now()
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now)
    try {
      for (let i = 0; i < 3; i++) await limiter.check('k')
      await expect(limiter.check('k')).resolves.toBe(false)

      nowSpy.mockReturnValue(now + 9_999)
      await expect(limiter.check('k')).resolves.toBe(false)

      nowSpy.mockReturnValue(now + 10_001)
      await expect(limiter.check('k')).resolves.toBe(true)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('keeps separate state per limiter instance (own prefix)', async () => {
    const a = makeLimiter('a:rate')
    const b = makeLimiter('b:rate')
    for (let i = 0; i < 3; i++) await a.check('same-key')
    await expect(a.check('same-key')).resolves.toBe(false)
    await expect(b.check('same-key')).resolves.toBe(true)
  })

  it('reset() clears the window', async () => {
    const limiter = makeLimiter()
    for (let i = 0; i < 3; i++) await limiter.check('k')
    await expect(limiter.check('k')).resolves.toBe(false)
    limiter.reset()
    await expect(limiter.check('k')).resolves.toBe(true)
  })

  it('warns once that KV is not configured, tagged with the limiter logTag', async () => {
    const limiter = makeLimiter()
    for (let i = 0; i < 5; i++) await limiter.check(`k${i}`)
    const kvWarns = mockedWarn.mock.calls.filter(c =>
      String(c[0]).includes('KV not configured')
    )
    expect(kvWarns).toHaveLength(1)
    expect(String(kvWarns[0][0])).toContain('[test-rate-limit]')
  })
})

describe('createSlidingWindowRateLimiter — KV configured (Upstash path)', () => {
  beforeEach(() => setKvEnv(true))

  it('builds one Upstash limiter with its own prefix and limits, and maps success', async () => {
    const limiter = makeLimiter('waitlist:rate')
    mockLimit.mockResolvedValueOnce({ success: true })
    await expect(limiter.check('ip-1')).resolves.toBe(true)
    mockLimit.mockResolvedValueOnce({ success: false })
    await expect(limiter.check('ip-1')).resolves.toBe(false)

    expect(mockRatelimitCtor).toHaveBeenCalledTimes(1)
    expect(mockRatelimitCtor.mock.calls[0][0]).toMatchObject({
      prefix: 'waitlist:rate',
      limiter: [3, '10 s'],
      analytics: false,
    })
    expect(mockLimit).toHaveBeenCalledWith('ip-1')
  })

  it('fails open (allows) and warns when the limiter backend throws', async () => {
    const limiter = makeLimiter()
    mockLimit.mockRejectedValueOnce(new Error('ECONNREFUSED redis down'))
    await expect(limiter.check('ip-2')).resolves.toBe(true)
    expect(mockedWarn).toHaveBeenCalledTimes(1)
    expect(String(mockedWarn.mock.calls[0][0])).toContain('ECONNREFUSED')
  })
})
