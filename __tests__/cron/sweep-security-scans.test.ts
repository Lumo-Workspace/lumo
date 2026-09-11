/** @jest-environment node */
const sweep = jest.fn()
jest.mock('@/lib/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    sweepStalePending: (...args: unknown[]) => sweep(...args),
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
  beforeEach(() => sweep.mockReset())

  it('401 without the cron secret and does not sweep', async () => {
    const res = await GET(reqWith(null))
    expect(res.status).toBe(401)
    const wrong = await GET(reqWith('Bearer nope'))
    expect(wrong.status).toBe(401)
    expect(sweep).not.toHaveBeenCalled()
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
    })
  })
})
