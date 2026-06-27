/** @jest-environment node */
const sweepUnjudged = jest.fn(async (_n: number) => ({ processed: 3 }))

jest.mock('@/lib/services/lineage-outcome.service', () => ({
  lineageOutcomeService: {
    sweepDoneTaskEdges: jest.fn(async () => ({ stamped: 0 })),
  },
}))
jest.mock('@/lib/services/memory/compaction.service', () => ({
  memoryCompactionService: {
    sweepColdProjectMemories: jest.fn(async () => ({ archived: 0 })),
  },
}))
jest.mock('@/lib/services/dependency-detection.service', () => ({
  dependencyDetectionService: {
    sweepSharedFileCandidates: jest.fn(async () => ({ suggested: 0 })),
  },
}))
jest.mock('@/lib/services/lineage/fragment-usage-audit.service', () => ({
  fragmentUsageAuditService: {
    auditDoneTaskSessions: jest.fn(async () => ({ processed: 0 })),
  },
}))
jest.mock('@/lib/services/claim-faithfulness.service', () => ({
  claimFaithfulnessService: { sweepUnjudged: (n: number) => sweepUnjudged(n) },
}))

import { GET } from '@/app/api/cron/backfill-lineage-outcomes/route'

function reqWith(auth: string | null) {
  return {
    headers: { get: (k: string) => (k === 'authorization' ? auth : null) },
  } as unknown as import('next/server').NextRequest
}

describe('backfill cron — claim faithfulness segment', () => {
  const OLD = process.env.CRON_SECRET
  beforeAll(() => {
    process.env.CRON_SECRET = 'secret'
  })
  afterAll(() => {
    process.env.CRON_SECRET = OLD
  })
  beforeEach(() => sweepUnjudged.mockClear())

  it('rejects an unauthorized request without sweeping', async () => {
    const res = await GET(reqWith('Bearer wrong'))
    expect(res.status).toBe(401)
    expect(sweepUnjudged).not.toHaveBeenCalled()
  })

  it('invokes the faithfulness sweep bounded by the batch cap', async () => {
    const res = await GET(reqWith('Bearer secret'))
    expect(res.status).toBe(200)
    expect(sweepUnjudged).toHaveBeenCalledTimes(1)
    expect(sweepUnjudged).toHaveBeenCalledWith(20)
    const body = await res.json()
    expect(body.faithfulness).toEqual({ processed: 3 })
  })
})
