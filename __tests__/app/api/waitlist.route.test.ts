/**
 * @jest-environment node
 *
 * LUM-983 — POST /api/waitlist is intentionally public (allow-listed in
 * api-route-auth-guard-coverage.test.ts), so it carries its own abuse
 * controls: a per-IP sliding-window rate limit and a bounded Zod schema.
 *
 * The real route handler and the real limiter logic run here. Only the
 * repository (DB) calls are mocked, plus the Upstash client for the
 * fail-open case. KV env is unset by default, so the in-memory window is
 * what's exercised — the same path production takes while KV is not
 * configured on Vercel.
 */
const mockLimit = jest.fn()

jest.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
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
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findWaitlistEntryByEmail: jest.fn(),
    createWaitlistEntry: jest.fn(),
  },
}))

import { POST } from '@/app/api/waitlist/route'
import { miscRepository } from '@/lib/repositories/misc.repository'

const mockFind = miscRepository.findWaitlistEntryByEmail as jest.Mock
const mockCreate = miscRepository.createWaitlistEntry as jest.Mock

const ORIGINAL_ENV = process.env

function post(
  body: unknown,
  ip: string,
  extraHeaders: Record<string, string> = {}
) {
  return POST(
    new Request('http://localhost/api/waitlist', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        ...extraHeaders,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )
}

const validBody = {
  email: 'Alice@Example.COM',
  name: ' Alice ',
  company: ' Acme ',
  teamSize: '2-5',
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ORIGINAL_ENV }
  delete process.env.KV_REST_API_URL
  delete process.env.KV_REST_API_TOKEN
  mockFind.mockResolvedValue(null)
  mockCreate.mockResolvedValue({ id: 'w1' })
})

afterAll(() => {
  process.env = ORIGINAL_ENV
})

describe('POST /api/waitlist', () => {
  it('creates a normal signup with a trimmed, lower-cased email → 201', async () => {
    const res = await post(validBody, '203.0.113.1')
    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledWith({
      email: 'alice@example.com',
      name: 'Alice',
      company: 'Acme',
      teamSize: '2-5',
    })
  })

  it('returns 429 on the 6th request from the same IP inside the window and does not write', async () => {
    const ip = '203.0.113.2'
    for (let i = 0; i < 5; i++) {
      const res = await post({ email: `user${i}@example.com` }, ip)
      expect(res.status).toBe(201)
    }
    expect(mockCreate).toHaveBeenCalledTimes(5)

    const limited = await post({ email: 'user5@example.com' }, ip)
    expect(limited.status).toBe(429)
    expect(mockCreate).toHaveBeenCalledTimes(5)
    expect(mockFind).toHaveBeenCalledTimes(5)

    // A different client IP is unaffected.
    const other = await post({ email: 'other@example.com' }, '203.0.113.3')
    expect(other.status).toBe(201)
  })

  it('keys the limit on the first x-forwarded-for hop', async () => {
    for (let i = 0; i < 5; i++) {
      await post({ email: `hop${i}@example.com` }, `198.51.100.7, 10.0.0.${i}`)
    }
    const limited = await post(
      { email: 'hop5@example.com' },
      '198.51.100.7, 10.0.0.99'
    )
    expect(limited.status).toBe(429)
  })

  it('rejects an oversize name → 400 without writing', async () => {
    const res = await post(
      { email: 'big-name@example.com', name: 'x'.repeat(10_000) },
      '203.0.113.4'
    )
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects an oversize company → 400 without writing', async () => {
    const res = await post(
      { email: 'big-co@example.com', company: 'x'.repeat(10_000) },
      '203.0.113.5'
    )
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('rejects an email longer than 254 characters → 400', async () => {
    const res = await post(
      { email: `${'a'.repeat(250)}@example.com` },
      '203.0.113.6'
    )
    expect(res.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('keeps the existing 400s for a missing or malformed email', async () => {
    const missing = await post({ name: 'No Email' }, '203.0.113.7')
    expect(missing.status).toBe(400)
    const bad = await post({ email: 'not-an-email' }, '203.0.113.7')
    expect(bad.status).toBe(400)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('fails open when the shared limiter itself errors', async () => {
    process.env.KV_REST_API_URL = 'https://example-kv.upstash.io'
    process.env.KV_REST_API_TOKEN = 'test-token'
    mockLimit.mockRejectedValue(new Error('ECONNREFUSED redis down'))

    const res = await post({ email: 'failopen@example.com' }, '203.0.113.8')
    expect(res.status).toBe(201)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})
