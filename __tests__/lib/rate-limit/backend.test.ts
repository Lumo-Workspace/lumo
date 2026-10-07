/**
 * @jest-environment node
 *
 * LUM-1020 — env-driven rate-limit backend selection: KV → Redis → memory.
 */
import { selectRateLimitBackend } from '@/lib/rate-limit/backend'

describe('selectRateLimitBackend', () => {
  it('selects kv when both KV REST vars are set', () => {
    expect(
      selectRateLimitBackend({
        KV_REST_API_URL: 'https://x.upstash.io',
        KV_REST_API_TOKEN: 't',
      })
    ).toBe('kv')
  })

  it('prefers kv over redis when both are configured (SaaS path unchanged)', () => {
    expect(
      selectRateLimitBackend({
        KV_REST_API_URL: 'https://x.upstash.io',
        KV_REST_API_TOKEN: 't',
        REDIS_URL: 'redis://localhost:6379',
      })
    ).toBe('kv')
  })

  it('selects redis when only REDIS_URL is set', () => {
    expect(
      selectRateLimitBackend({ REDIS_URL: 'redis://localhost:6379' })
    ).toBe('redis')
  })

  it('does not treat a half-configured KV (URL without token) as kv', () => {
    expect(
      selectRateLimitBackend({
        KV_REST_API_URL: 'https://x.upstash.io',
        REDIS_URL: 'redis://localhost:6379',
      })
    ).toBe('redis')
    expect(selectRateLimitBackend({ KV_REST_API_TOKEN: 't' })).toBe('memory')
  })

  it('falls back to memory when nothing (or only empty strings) is configured', () => {
    expect(selectRateLimitBackend({})).toBe('memory')
    expect(
      selectRateLimitBackend({
        KV_REST_API_URL: '',
        KV_REST_API_TOKEN: '',
        REDIS_URL: '',
      })
    ).toBe('memory')
  })

  it('reads process.env by default', () => {
    const original = process.env
    try {
      process.env = { ...original, REDIS_URL: 'redis://r:6379' }
      delete process.env.KV_REST_API_URL
      delete process.env.KV_REST_API_TOKEN
      expect(selectRateLimitBackend()).toBe('redis')
    } finally {
      process.env = original
    }
  })
})
