/** @jest-environment node */
const sweep = jest.fn()
const sweepHunts = jest.fn()
const sweepHolds = jest.fn()
const sweepRewardHacks = jest.fn().mockResolvedValue({ failed: 0 })
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/ee/security/services/security-managed-scan-ops.service', () => ({
  securityManagedScanOpsService: {
    sweepStalePending: (...args: unknown[]) => sweep(...args),
  },
}))
jest.mock('@/ee/security/services/security-hunt-ops.service', () => ({
  securityHuntOpsService: {
    sweepStaleHunts: (...args: unknown[]) => sweepHunts(...args),
    sweepStaleRewardHacks: (...args: unknown[]) => sweepRewardHacks(...args),
  },
}))

jest.mock('@/ee/security/services/review-verifier-ops.service', () => ({
  reviewVerifierOpsService: {
    sweepStaleHolds: (...args: unknown[]) => sweepHolds(...args),
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
    sweepHolds.mockReset()
    sweepHolds.mockResolvedValue({ released: 0 })
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
      verifier: { released: 0 },
      rewardHack: { failed: 0 },
    })
  })

  it('sweep cron runs both the external and the hunt sweep', async () => {
    // LUM-822: the hunt sweep runs alongside, and one throwing skips neither.
    sweep.mockRejectedValue(new Error('external down'))
    const res = await GET(reqWith('Bearer secret'))
    expect(sweep).toHaveBeenCalledWith()
    expect(sweepHunts).toHaveBeenCalledWith()
    expect(res.status).toBe(500)
    await expect(res.json()).resolves.toEqual({
      hunt: HUNT,
      verifier: { released: 0 },
      rewardHack: { failed: 0 },
    })

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
      verifier: { released: 0 },
      rewardHack: { failed: 0 },
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

describe('LUM-988 the sweep cron also releases stale verifier holds', () => {
  const OLD = process.env.CRON_SECRET
  beforeAll(() => {
    process.env.CRON_SECRET = 'secret'
  })
  afterAll(() => {
    process.env.CRON_SECRET = OLD
  })
  it('runs the verifier sweep alongside, reports it, and a failure there fails the run without skipping the others', async () => {
    sweep.mockReset()
    sweep.mockResolvedValue({ swept: 0, cancelled: 0, sandboxesStopped: 0 })
    sweepHunts.mockReset()
    sweepHunts.mockResolvedValue({
      retried: 0,
      failed: 0,
      cancelled: 0,
      sandboxesStopped: 0,
    })
    sweepHolds.mockReset()
    sweepHolds.mockResolvedValue({ released: 2 })
    const ok = await GET(reqWith('Bearer secret'))
    expect(sweepHolds).toHaveBeenCalledWith()
    expect(ok.status).toBe(200)
    expect((await ok.json()).verifier).toEqual({ released: 2 })

    sweepHolds.mockRejectedValue(new Error('db down'))
    const bad = await GET(reqWith('Bearer secret'))
    expect(bad.status).toBe(500)
    expect(sweep).toHaveBeenCalledTimes(2)
    expect(sweepHunts).toHaveBeenCalledTimes(2)
  })
})

describe('LUM-1234 the sweep cron also settles stale reward-hack layers', () => {
  const OLD = process.env.CRON_SECRET
  beforeAll(() => {
    process.env.CRON_SECRET = 'secret'
  })
  afterAll(() => {
    process.env.CRON_SECRET = OLD
  })
  it('runs the reward-hack sweep alongside and a failure there fails the run without skipping the others', async () => {
    sweep.mockReset()
    sweep.mockResolvedValue({ swept: 0, cancelled: 0, sandboxesStopped: 0 })
    sweepHunts.mockReset()
    sweepHunts.mockResolvedValue({
      retried: 0,
      failed: 0,
      cancelled: 0,
      sandboxesStopped: 0,
    })
    sweepHolds.mockReset()
    sweepHolds.mockResolvedValue({ released: 0 })
    sweepRewardHacks.mockReset()
    sweepRewardHacks.mockResolvedValue({ failed: 3 })
    const ok = await GET(reqWith('Bearer secret'))
    expect(sweepRewardHacks).toHaveBeenCalledWith()
    expect(ok.status).toBe(200)
    expect((await ok.json()).rewardHack).toEqual({ failed: 3 })

    sweepRewardHacks.mockRejectedValue(new Error('db down'))
    const bad = await GET(reqWith('Bearer secret'))
    expect(bad.status).toBe(500)
    expect(sweepHunts).toHaveBeenCalledTimes(2)
    expect((await bad.json()).rewardHack).toBeNull()
  })
})
