/**
 * @jest-environment node
 *
 * LUM-732 — POST /api/internal/pr-security-scan: the dedicated foreground
 * worker a PR webhook or a manual link dispatches to (via
 * pr-security-scan-dispatch.ts) so the diff fetch, secret scan and LLM judge
 * run with a full 300s budget instead of inline in a ~15s waitUntil.
 * Self-call only: gated by the shared CRON_SECRET.
 */
jest.mock('@/lib/services/pr-security-scan.service', () => ({
  prSecurityScanService: { run: jest.fn() },
}))
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))

import { POST } from '@/app/api/internal/pr-security-scan/route'
import { prSecurityScanService } from '@/lib/services/pr-security-scan.service'
import { logger } from '@/lib/logger'

const run = prSecurityScanService.run as jest.Mock
const error = logger.error as jest.Mock
const info = logger.info as jest.Mock

const makeReq = (auth: string | null, body: unknown | (() => unknown)) =>
  ({
    headers: {
      get: (k: string) => (k.toLowerCase() === 'authorization' ? auth : null),
    },
    json: async () => {
      if (typeof body === 'function') return (body as () => unknown)()
      return body
    },
  }) as never

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'secret'
  run.mockResolvedValue({ status: 'CLEAN' })
})

describe('POST /api/internal/pr-security-scan is auth-gated and runs the posted scan', () => {
  it('rejects a missing bearer with 401', async () => {
    const res = await POST(makeReq(null, { pullRequestId: 'pr1' }))
    expect(res.status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a wrong bearer with 401', async () => {
    const res = await POST(makeReq('Bearer nope', { pullRequestId: 'pr1' }))
    expect(res.status).toBe(401)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON with 400', async () => {
    const res = await POST(
      makeReq('Bearer secret', () => {
        throw new Error('bad json')
      })
    )
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects a missing pullRequestId with 400', async () => {
    const res = await POST(makeReq('Bearer secret', {}))
    expect(res.status).toBe(400)
    expect(run).not.toHaveBeenCalled()
  })

  it('runs the scan with PR_EVENT default trigger and echoes the result as 200', async () => {
    run.mockResolvedValue({ status: 'CLEAN', findingCount: 0 })
    const res = await POST(makeReq('Bearer secret', { pullRequestId: 'pr1' }))
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
    expect(await res.json()).toEqual({ status: 'CLEAN', findingCount: 0 })
  })

  it('passes through an explicit PR_LINK trigger', async () => {
    const res = await POST(
      makeReq('Bearer secret', { pullRequestId: 'pr1', trigger: 'PR_LINK' })
    )
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith({
      pullRequestId: 'pr1',
      trigger: 'PR_LINK',
    })
  })

  it('passes through an explicit SARIF_PUSH trigger', async () => {
    // LUM-735 review I3: the SARIF ingest asks for stage A when the push
    // created the scan row before any PR webhook arrived. Without this the
    // trigger fell back to PR_EVENT and the scan row lied about its origin.
    const res = await POST(
      makeReq('Bearer secret', { pullRequestId: 'pr1', trigger: 'SARIF_PUSH' })
    )
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith({
      pullRequestId: 'pr1',
      trigger: 'SARIF_PUSH',
    })
  })

  it('falls back to PR_EVENT for an unknown trigger', async () => {
    const res = await POST(
      makeReq('Bearer secret', { pullRequestId: 'pr1', trigger: 'NOPE' })
    )
    expect(res.status).toBe(200)
    expect(run).toHaveBeenCalledWith({
      pullRequestId: 'pr1',
      trigger: 'PR_EVENT',
    })
  })

  it('returns 502 with a generic error and logs when run() rejects', async () => {
    run.mockRejectedValue(new Error('boom'))
    const res = await POST(makeReq('Bearer secret', { pullRequestId: 'pr1' }))
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'scan failed' })
    expect(error).toHaveBeenCalled()
  })

  it('echoes a skipped result as 200 and logs info', async () => {
    run.mockResolvedValue({ skipped: true, reason: 'pr_not_found' })
    const res = await POST(makeReq('Bearer secret', { pullRequestId: 'pr1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      skipped: true,
      reason: 'pr_not_found',
    })
    expect(info).toHaveBeenCalled()
  })
})
