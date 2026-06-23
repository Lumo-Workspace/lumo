/**
 * @jest-environment node
 *
 * LUM-576 — POST /api/internal/run-summary: the dedicated foreground
 * run-summary worker. Runs the per-session generation in its own function with
 * a full time budget (maxDuration 300), NOT in the cramped post-task waitUntil.
 * Auth-gated by the shared CRON_SECRET (self-call only). One task per request;
 * no DB scan, no fan-out.
 */
jest.mock('@/lib/services/run-summary.service', () => ({
  runSummaryService: { generateForTask: jest.fn() },
}))

import { POST } from '@/app/api/internal/run-summary/route'
import { runSummaryService } from '@/lib/services/run-summary.service'

const mGenerate = runSummaryService.generateForTask as jest.Mock

const makeReq = (auth: string | null, body: unknown) =>
  ({
    headers: {
      get: (k: string) => (k.toLowerCase() === 'authorization' ? auth : null),
    },
    json: async () => body,
  }) as never

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = 'test-secret'
  mGenerate.mockResolvedValue({
    generated: 2,
    failed: 0,
    skippedEmpty: 1,
    degraded: false,
  })
})

describe('internal run-summary route is auth-gated and generates for the posted task', () => {
  it('rejects a request without the CRON_SECRET bearer with 401', async () => {
    const res = await POST(makeReq(null, { taskId: 't1' }))
    expect(res.status).toBe(401)
    expect(mGenerate).not.toHaveBeenCalled()
  })

  it('rejects a wrong bearer with 401', async () => {
    const res = await POST(makeReq('Bearer nope', { taskId: 't1' }))
    expect(res.status).toBe(401)
    expect(mGenerate).not.toHaveBeenCalled()
  })

  it('invokes generateForTask for the posted task on a valid bearer', async () => {
    const res = await POST(makeReq('Bearer test-secret', { taskId: 't1' }))
    expect(res.status).toBe(200)
    expect(mGenerate).toHaveBeenCalledWith('t1')
    expect(await res.json()).toEqual({
      generated: 2,
      failed: 0,
      skippedEmpty: 1,
      degraded: false,
    })
  })

  it('rejects a missing taskId with 400', async () => {
    const res = await POST(makeReq('Bearer test-secret', {}))
    expect(res.status).toBe(400)
    expect(mGenerate).not.toHaveBeenCalled()
  })

  it('still returns 200 with the degraded result so the failure is observable', async () => {
    mGenerate.mockResolvedValue({
      generated: 1,
      failed: 2,
      skippedEmpty: 0,
      degraded: true,
    })
    const res = await POST(makeReq('Bearer test-secret', { taskId: 't1' }))
    expect(res.status).toBe(200)
    expect((await res.json()).degraded).toBe(true)
  })
})
