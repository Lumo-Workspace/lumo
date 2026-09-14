/** @jest-environment node */
const sweep = jest.fn()
jest.mock('@/lib/services/boundary-crossing-rejudge.service', () => ({
  boundaryCrossingRejudgeService: {
    sweep: (...args: unknown[]) => sweep(...args),
  },
}))

import { GET } from '@/app/api/cron/rejudge-crossings/route'

function reqWith(auth: string | null) {
  return {
    headers: { get: (k: string) => (k === 'authorization' ? auth : null) },
  } as unknown as import('next/server').NextRequest
}

describe('GET /api/cron/rejudge-crossings (LUM-780)', () => {
  const OLD = process.env.CRON_SECRET
  beforeAll(() => {
    process.env.CRON_SECRET = 'secret'
  })
  afterAll(() => {
    process.env.CRON_SECRET = OLD
  })
  beforeEach(() => sweep.mockReset())

  it('401 without the cron secret and does not sweep', async () => {
    expect((await GET(reqWith(null))).status).toBe(401)
    expect((await GET(reqWith('Bearer nope'))).status).toBe(401)
    expect(sweep).not.toHaveBeenCalled()
  })

  it('fails closed when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET
    expect((await GET(reqWith('Bearer undefined'))).status).toBe(401)
    process.env.CRON_SECRET = 'secret'
    expect(sweep).not.toHaveBeenCalled()
  })

  it('sweeps both categories with the service defaults and returns the counts (not the per-row decisions)', async () => {
    sweep.mockResolvedValue({
      judged: 3,
      downgraded: 2,
      stillHolds: 1,
      undecidable: 0,
      errors: 0,
      byReason: { RULE_TEXT_PRESENT: 2, TEST_FILE_REMOVED_IN_PR: 1 },
      decisions: [{ id: 'x' }],
    })
    const res = await GET(reqWith('Bearer secret'))
    expect(res.status).toBe(200)
    expect(sweep).toHaveBeenCalledWith()
    await expect(res.json()).resolves.toEqual({
      judged: 3,
      downgraded: 2,
      stillHolds: 1,
      undecidable: 0,
      errors: 0,
      byReason: { RULE_TEXT_PRESENT: 2, TEST_FILE_REMOVED_IN_PR: 1 },
    })
  })
})
