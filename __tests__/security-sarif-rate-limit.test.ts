/**
 * @jest-environment node
 *
 * LUM-735 — the SARIF ingest rate limiter is a mitigation (spec R1c), not
 * the auth boundary, so it must never take the ingest endpoint down. In
 * production this repo has no KV configured (`KV_REST_API_URL` /
 * `KV_REST_API_TOKEN` unset), and constructing `@vercel/kv`'s `kv` client
 * throws on first use in that case — which used to surface as a 500 right
 * after successful OIDC auth. These tests cover: the in-memory fallback
 * used when KV isn't configured, the Upstash path used when it is, and
 * fail-open behavior when the Upstash call itself throws.
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
import {
  checkSarifIngestRateLimit,
  __resetRateLimiterForTests,
} from '@/lib/services/security-sarif-rate-limit'

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

beforeEach(() => {
  jest.clearAllMocks()
  __resetRateLimiterForTests()
  setKvEnv(false)
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('checkSarifIngestRateLimit — KV not configured (in-memory fallback)', () => {
  it('allows up to 30 calls per key then throws 429 on the 31st, while a different key still passes', async () => {
    for (let i = 0; i < 30; i++) {
      await expect(checkSarifIngestRateLimit('key-a')).resolves.toBeUndefined()
    }
    await expect(checkSarifIngestRateLimit('key-a')).rejects.toMatchObject({
      status: 429,
    })
    await expect(checkSarifIngestRateLimit('key-b')).resolves.toBeUndefined()
  })

  it('allows the key again once the window has elapsed', async () => {
    const now = Date.now()
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now)

    for (let i = 0; i < 30; i++) {
      await checkSarifIngestRateLimit('key-c')
    }
    await expect(checkSarifIngestRateLimit('key-c')).rejects.toMatchObject({
      status: 429,
    })

    nowSpy.mockReturnValue(now + 60_001)
    await expect(checkSarifIngestRateLimit('key-c')).resolves.toBeUndefined()

    nowSpy.mockRestore()
  })

  it('logs the "KV not configured" warning exactly once across many calls', async () => {
    for (let i = 0; i < 5; i++) {
      await checkSarifIngestRateLimit(`key-${i}`)
    }
    const kvWarnCalls = mockedWarn.mock.calls.filter(call =>
      String(call[0]).includes('KV not configured')
    )
    expect(kvWarnCalls).toHaveLength(1)
  })
})

describe('checkSarifIngestRateLimit — KV configured (Upstash path)', () => {
  beforeEach(() => setKvEnv(true))

  it('uses the Upstash limiter, calling limit with the key, and throws 429 on success:false', async () => {
    mockLimit.mockResolvedValueOnce({ success: true })
    await expect(
      checkSarifIngestRateLimit('gh:pr:123')
    ).resolves.toBeUndefined()
    expect(mockRatelimitCtor).toHaveBeenCalledTimes(1)
    expect(mockLimit).toHaveBeenCalledWith('gh:pr:123')

    mockLimit.mockResolvedValueOnce({ success: false })
    await expect(checkSarifIngestRateLimit('gh:pr:123')).rejects.toMatchObject({
      status: 429,
    })
  })

  it('fails open and logs a warning when the Upstash call itself throws', async () => {
    mockLimit.mockRejectedValueOnce(new Error('ECONNREFUSED redis down'))
    await expect(
      checkSarifIngestRateLimit('gh:pr:456')
    ).resolves.toBeUndefined()
    expect(mockedWarn).toHaveBeenCalledTimes(1)
    expect(String(mockedWarn.mock.calls[0][0])).toContain('ECONNREFUSED')
  })
})
