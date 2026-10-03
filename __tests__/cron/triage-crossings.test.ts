/** @jest-environment node */
const sweep = jest.fn()
jest.mock('@/lib/services/boundary-crossing-triage.service', () => ({
  boundaryCrossingTriageService: {
    sweep: (...args: unknown[]) => sweep(...args),
  },
}))

import { GET } from '@/app/api/cron/triage-crossings/route'

function reqWith(auth: string | null) {
  return {
    headers: { get: (k: string) => (k === 'authorization' ? auth : null) },
  } as unknown as import('next/server').NextRequest
}

describe('LUM-945 triage cron', () => {
  const OLD = process.env.CRON_SECRET
  beforeAll(() => {
    process.env.CRON_SECRET = 'secret'
  })
  afterAll(() => {
    process.env.CRON_SECRET = OLD
  })
  beforeEach(() => sweep.mockReset())

  it('rejects a request without the cron secret and does not sweep', async () => {
    expect((await GET(reqWith(null))).status).toBe(401)
    expect((await GET(reqWith('Bearer nope'))).status).toBe(401)
    expect(sweep).not.toHaveBeenCalled()
  })

  it('sweeps with the service defaults and returns the summary', async () => {
    const summary = {
      candidates: 3,
      scored: 2,
      autoCleared: 1,
      skipped: 1,
      aiReviewOff: 0,
      errors: 0,
      pausedCategories: [],
    }
    sweep.mockResolvedValue(summary)
    const res = await GET(reqWith('Bearer secret'))
    expect(res.status).toBe(200)
    expect(sweep).toHaveBeenCalledWith()
    await expect(res.json()).resolves.toEqual(summary)
  })
})
