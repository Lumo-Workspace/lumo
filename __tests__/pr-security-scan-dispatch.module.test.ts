/**
 * @jest-environment node
 *
 * LUM-732 review — exercises the REAL dispatchPrSecurityScan implementation
 * (pr-security-scan-dispatch.test.ts mocks this module entirely, so the fetch
 * call, headers, body, and best-effort error handling were never actually
 * covered). Mocks only global.fetch and the logger.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import { dispatchPrSecurityScan } from '@/lib/services/pr-security-scan-dispatch'
import { logger } from '@/lib/logger'

const warn = logger.warn as jest.Mock

const realEnv = { ...process.env }

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...realEnv }
})

afterEach(() => {
  process.env = { ...realEnv }
})

describe('dispatchPrSecurityScan (real implementation)', () => {
  it('posts to the internal worker with the bearer secret and JSON body', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
    process.env.CRON_SECRET = 's3'
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 })
    global.fetch = fetchMock as never

    await dispatchPrSecurityScan('pr1', 'PR_LINK')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://app.test/api/internal/pr-security-scan')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe('Bearer s3')
    expect(JSON.parse(init.body)).toEqual({
      pullRequestId: 'pr1',
      trigger: 'PR_LINK',
    })
  })

  it('skips (no fetch) and warns when NEXT_PUBLIC_APP_URL is unset', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    const fetchMock = jest.fn()
    global.fetch = fetchMock as never

    await dispatchPrSecurityScan('pr1', 'PR_EVENT')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })

  it('swallows a fetch rejection and warns, never throws', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
    global.fetch = jest.fn().mockRejectedValue(new Error('network')) as never

    await expect(
      dispatchPrSecurityScan('pr1', 'PR_EVENT')
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalled()
  })

  it('warns on a non-2xx worker response', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 401 }) as never

    await dispatchPrSecurityScan('pr1', 'PR_EVENT')

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('401'))
  })
})
