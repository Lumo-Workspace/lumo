/**
 * @jest-environment node
 *
 * LUM-1332 — the self-host configuration check: one result per component,
 * `skipped` for what is not configured, `failed` with a hint for what is
 * configured but does not work. Probes are fakes here; the real services are
 * exercised by the compose end-to-end run.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
const mockEval = jest.fn()
jest.mock('@/lib/rate-limit/redis-client', () => ({
  getSharedRedisClient: async () => ({ eval: (...a: unknown[]) => mockEval(...a) }),
}))

import {
  CHECK_TIMEOUT_MS,
  defaultSelfHostProbes,
  errorText,
  readStart,
  runSelfHostChecks,
  type CheckResult,
  type SelfHostProbes,
} from '@/lib/services/self-host-check.service'
import { PUBLIC_CONFIG_GLOBAL } from '@/lib/config/public-config'

const DISK_ENV = { LOCAL_BLOB_DIR: '/var/lib/lumo/blobs', BLOB_STORAGE: 'disk' }

function probes(over: Partial<SelfHostProbes> = {}): SelfHostProbes {
  return {
    pingDatabase: async () => {},
    roundTripBlob: async () => {},
    verifyEmail: async () => ({ status: 'not_configured' }),
    pingRedis: async () => {},
    checkRealtime: async () => ({ status: 'not_configured' }),
    fetchUrl: async () => ({ status: 200, body: `window.${PUBLIC_CONFIG_GLOBAL}={}` }),
    ...over,
  }
}

function byId(results: CheckResult[]): Record<string, CheckResult> {
  return Object.fromEntries(results.map(r => [r.id, r]))
}

describe('defaultSelfHostProbes.pingRedis', () => {
  it('retries while the shared client is still connecting, then succeeds', async () => {
    jest.useFakeTimers()
    try {
      mockEval
        .mockReset()
        .mockRejectedValueOnce(new Error('The client is offline'))
        .mockRejectedValueOnce(new Error('The client is offline'))
        .mockResolvedValue(1)
      const pending = defaultSelfHostProbes.pingRedis('redis://redis:6379')
      await jest.advanceTimersByTimeAsync(1_000)
      await expect(pending).resolves.toBeUndefined()
      expect(mockEval).toHaveBeenCalledTimes(3)
    } finally {
      jest.useRealTimers()
    }
  })

  it('gives up with the last error once its budget is spent', async () => {
    jest.useFakeTimers()
    try {
      mockEval.mockReset().mockRejectedValue(new Error('The client is offline'))
      const pending = defaultSelfHostProbes.pingRedis('redis://redis:6379')
      const settled = expect(pending).rejects.toThrow('offline')
      await jest.advanceTimersByTimeAsync(11_000)
      await settled
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('readStart', () => {
  it('returns at most the limit and stops reading the rest', async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        controller.enqueue(new Uint8Array(1024).fill(97))
      },
    })
    const text = await readStart(new Response(body), 2500)
    expect(text).toBe('a'.repeat(2500))
    expect(pulls).toBeLessThan(10)
    expect(await readStart(new Response(null), 10)).toBe('')
  })
})

describe('errorText', () => {
  it("adds the cause of a bare 'fetch failed'", () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND lumo.example.com'), {
      code: 'ENOTFOUND',
    })
    expect(errorText(Object.assign(new TypeError('fetch failed'), { cause }))).toBe(
      'fetch failed: ENOTFOUND getaddrinfo ENOTFOUND lumo.example.com'
    )
    expect(errorText(new Error('plain'))).toBe('plain')
    expect(errorText('text')).toBe('text')
  })

  it('masks the userinfo of a URL a driver echoes', () => {
    // Assembled at runtime so no credential-shaped URL sits in the source.
    const url = ['redis:', '', ['default', 'fixture'].join(':') + '@redis:6379'].join('/')
    expect(errorText(new Error(`connect failed: ${url}`))).toBe(
      'connect failed: redis://***@redis:6379'
    )
  })
})

describe('runSelfHostChecks', () => {
  it('a minimal stack: core checks ok, optional components skipped, in a fixed order', async () => {
    const results = await runSelfHostChecks(probes(), DISK_ENV, 'http://localhost:3000')
    expect(results.map(r => r.id)).toEqual([
      'database',
      'storage',
      'email',
      'redis',
      'realtime',
      'public_url',
    ])
    expect(results.map(r => r.status)).toEqual([
      'ok',
      'ok',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
    ])
    expect(byId(results).storage?.detail).toContain('disk')
    expect(byId(results).email?.hint).toContain('SMTP_URL')
  })

  it('reports each configured component that does not work, with a hint', async () => {
    const results = byId(
      await runSelfHostChecks(
        probes({
          pingDatabase: async () => {
            throw new Error('connect ECONNREFUSED')
          },
          roundTripBlob: async () => {
            throw new Error('EACCES: permission denied')
          },
          verifyEmail: async () => ({
            status: 'failed',
            error: { name: 'Error', message: 'Invalid login', code: 'EAUTH', statusCode: 535 },
          }),
          pingRedis: async () => {
            throw new Error('The client is closed')
          },
          checkRealtime: async () => ({ status: 'failed', message: 'HTTP 401' }),
          fetchUrl: async () => {
            throw new Error('getaddrinfo ENOTFOUND lumo.example.com')
          },
        }),
        { ...DISK_ENV, REDIS_URL: 'redis://redis:6379' },
        'https://lumo.example.com'
      )
    )
    for (const id of ['database', 'storage', 'email', 'redis', 'realtime', 'public_url']) {
      expect(results[id]?.status).toBe('failed')
      expect(results[id]?.hint).toBeTruthy()
    }
    expect(results.email?.detail).toBe('EAUTH 535 Invalid login')
    expect(results.email?.hint).toContain('SMTP_USER')
    expect(results.public_url?.hint).toContain('--caddy')
    expect(results.storage?.hint).toContain('LOCAL_BLOB_DIR')
  })

  it('everything configured and working is ok', async () => {
    const pingRedis = jest.fn(async () => {})
    const results = byId(
      await runSelfHostChecks(
        probes({
          verifyEmail: async () => ({ status: 'ok', transport: 'smtp' }),
          pingRedis,
          checkRealtime: async () => ({ status: 'ok' }),
        }),
        { BLOB_STORAGE: 's3', S3_BUCKET: 'lumo', REDIS_URL: ' redis://redis:6379 ' },
        'https://lumo.example.com'
      )
    )
    expect(Object.values(results).every(r => r.status === 'ok')).toBe(true)
    expect(pingRedis).toHaveBeenCalledWith('redis://redis:6379')
    expect(results.storage?.detail).toContain('s3')
    expect(results.email?.detail).toContain('no mail sent')
  })

  it('a public URL that answers but is not Lumo fails', async () => {
    const results = byId(
      await runSelfHostChecks(
        probes({ fetchUrl: async () => ({ status: 502, body: 'Bad Gateway' }) }),
        DISK_ENV,
        'http://192.168.1.20:3000'
      )
    )
    expect(results.public_url?.status).toBe('failed')
    expect(results.public_url?.detail).toContain('HTTP 502')
  })

  it('loopback forms count as local and are skipped', async () => {
    for (const url of ['http://lumo.localhost:3000', 'http://127.0.0.2:3000', 'http://[::1]:3000']) {
      expect(byId(await runSelfHostChecks(probes(), DISK_ENV, url)).public_url?.status).toBe('skipped')
    }
    // A real domain that merely starts with 127. is checked.
    expect(
      byId(await runSelfHostChecks(probes(), DISK_ENV, 'https://127.example.com')).public_url?.status
    ).toBe('ok')
  })

  it('a missing or invalid public URL fails', async () => {
    expect(byId(await runSelfHostChecks(probes(), DISK_ENV, undefined)).public_url?.status).toBe('failed')
    expect(byId(await runSelfHostChecks(probes(), DISK_ENV, 'not a url')).public_url?.status).toBe('failed')
  })

  it('a check that hangs fails after the timeout instead of holding up the report', async () => {
    jest.useFakeTimers()
    try {
      const pending = runSelfHostChecks(
        probes({ pingDatabase: () => new Promise<void>(() => {}) }),
        DISK_ENV,
        'http://localhost:3000'
      )
      await jest.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS + 1)
      const results = byId(await pending)
      expect(results.database?.status).toBe('failed')
      expect(results.database?.detail).toContain('did not answer')
      expect(results.storage?.status).toBe('ok')
    } finally {
      jest.useRealTimers()
    }
  })
})
