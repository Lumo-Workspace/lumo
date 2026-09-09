/**
 * @jest-environment node
 *
 * LUM-735 — exercises the REAL dispatchSecuritySarifIngest implementation
 * (mirrors __tests__/pr-security-scan-dispatch.module.test.ts). Mocks only
 * global.fetch and the logger — never the module under test.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import { dispatchSecuritySarifIngest } from '@/lib/services/security-sarif-ingest-dispatch'
import { logger } from '@/lib/logger'

const warn = logger.warn as jest.Mock

const realEnv = { ...process.env }

const JOB = {
  url: 'https://blob.vercel-storage.com/security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  pathname: 'security-sarif/o--r/sha1/semgrep-abc.sarif.gz',
  workspaceId: 'w1',
  repository: 'o/r',
  headSha: 'sha1',
  prNumber: 7,
  tool: 'semgrep',
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...realEnv }
})

afterEach(() => {
  process.env = { ...realEnv }
})

describe('dispatchSecuritySarifIngest (real implementation)', () => {
  it('posts the job to the internal worker with the bearer secret and JSON body', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
    process.env.CRON_SECRET = 's3'
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    global.fetch = fetchMock as never

    await dispatchSecuritySarifIngest(JOB)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://app.test/api/internal/security-sarif-ingest')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer s3')
    expect(JSON.parse(init.body)).toEqual(JOB)
  })

  it('skips (no fetch) and warns when NEXT_PUBLIC_APP_URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const fetchMock = jest.fn()
    global.fetch = fetchMock as never

    await dispatchSecuritySarifIngest(JOB)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('swallows a fetch rejection and warns, never throws', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as never

    await expect(dispatchSecuritySarifIngest(JOB)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('warns on a non-2xx worker response', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 401 }) as never

    await dispatchSecuritySarifIngest(JOB)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('401'))
  })
})
