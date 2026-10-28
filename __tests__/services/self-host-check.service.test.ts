/**
 * @jest-environment node
 *
 * LUM-1332 — the self-host configuration check: one result per component,
 * `skipped` for what is not configured, `failed` with a hint for what is
 * configured but does not work. Probes are fakes here; the real services are
 * exercised by the compose end-to-end run.
 */
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import {
  CHECK_TIMEOUT_MS,
  errorText,
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
