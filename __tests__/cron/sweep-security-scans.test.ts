/** @jest-environment node */
const sweep = jest.fn()
const sweepHunts = jest.fn()
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    sweepStalePending: (...args: unknown[]) => sweep(...args),
  },
}))
jest.mock('@/lib/services/security-hunt-ops.service', () => ({
  securityHuntOpsService: {
    sweepStaleHunts: (...args: unknown[]) => sweepHunts(...args),
  },
}))

import { GET } from '@/app/api/cron/sweep-security-scans/route'

function reqWith(auth: string | null) {
  return {
    headers: { get: (k: string) => (k === 'authorization' ? auth : null) },
  } as unknown as import('next/server').NextRequest
}

describe('GET /api/cron/sweep-security-scans (LUM-745)', () => {
  const OLD = process.env.CRON_SECRET
  beforeAll(() => {
    process.env.CRON_SECRET = 'secret'
  })
  afterAll(() => {
    process.env.CRON_SECRET = OLD
  })
  const HUNT = { retried: 1, failed: 0, cancelled: 1, sandboxesStopped: 0 }
  beforeEach(() => {
    sweep.mockReset()
    sweepHunts.mockReset()
    sweepHunts.mockResolvedValue(HUNT)
  })

  it('401 without the cron secret and does not sweep', async () => {
    const res = await GET(reqWith(null))
    expect(res.status).toBe(401)
    const wrong = await GET(reqWith('Bearer nope'))
    expect(wrong.status).toBe(401)
    expect(sweep).not.toHaveBeenCalled()
    expect(sweepHunts).not.toHaveBeenCalled()
  })

  it('sweeps with the service defaults and returns its counts', async () => {
    sweep.mockResolvedValue({ swept: 2, cancelled: 1, sandboxesStopped: 1 })
    const res = await GET(reqWith('Bearer secret'))
    expect(res.status).toBe(200)
    expect(sweep).toHaveBeenCalledWith()
    await expect(res.json()).resolves.toEqual({
      swept: 2,
      cancelled: 1,
      sandboxesStopped: 1,
      hunt: HUNT,
    })
  })

  it('sweep cron runs both the external and the hunt sweep', async () => {
    // LUM-822: the hunt sweep runs alongside, and one throwing skips neither.
    sweep.mockRejectedValue(new Error('external down'))
    const res = await GET(reqWith('Bearer secret'))
    expect(sweep).toHaveBeenCalledWith()
    expect(sweepHunts).toHaveBeenCalledWith()
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({ hunt: HUNT })

    sweep.mockReset()
    sweep.mockResolvedValue({ swept: 0, cancelled: 0, sandboxesStopped: 0 })
    sweepHunts.mockRejectedValue(new Error('hunt down'))
    const res2 = await GET(reqWith('Bearer secret'))
    expect(sweep).toHaveBeenCalledTimes(1)
    expect(res2.status).toBe(500)
    await expect(res2.json()).resolves.toEqual({
      swept: 0,
      cancelled: 0,
      sandboxesStopped: 0,
      hunt: null,
    })
  })

  it('401 when CRON_SECRET is unset, even for the literal "Bearer undefined"', async () => {
    const saved = process.env.CRON_SECRET
    delete process.env.CRON_SECRET
    try {
      sweep.mockReset()
      const res = await GET(reqWith('Bearer undefined'))
      expect(res.status).toBe(401)
      expect(sweep).not.toHaveBeenCalled()
    } finally {
      process.env.CRON_SECRET = saved
    }
  })
})
