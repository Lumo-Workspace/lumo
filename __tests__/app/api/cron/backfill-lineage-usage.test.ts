/**
 * @jest-environment node
 */
const sweepDoneTaskEdges = jest.fn().mockResolvedValue({ count: 2 })
const auditDoneTaskSessions = jest
  .fn()
  .mockResolvedValue({ processed: 3, sessionIds: ['a', 'b', 'c'] })
jest.mock('@/lib/services/lineage-outcome.service', () => ({
  lineageOutcomeService: { sweepDoneTaskEdges: () => sweepDoneTaskEdges() },
}))
jest.mock('@/lib/services/lineage/fragment-usage-audit.service', () => ({
  fragmentUsageAuditService: {
    auditDoneTaskSessions: (n: number) => auditDoneTaskSessions(n),
  },
}))
jest.mock('@/lib/services/memory/compaction.service', () => ({
  memoryCompactionService: {
    sweepColdProjectMemories: jest.fn().mockResolvedValue({
      projectsOverThreshold: 0,
      archivedTotal: 0,
      projects: [],
    }),
  },
}))
jest.mock('@/lib/services/dependency-detection.service', () => ({
  dependencyDetectionService: {
    sweepSharedFileCandidates: jest.fn().mockResolvedValue({ suggested: 0 }),
  },
}))

import { GET } from '@/app/api/cron/backfill-lineage-outcomes/route'

it('rejects without the cron secret', async () => {
  const res = await GET(new Request('http://x', { headers: {} }) as never)
  expect(res.status).toBe(401)
})

it('runs both the outcome sweep and the usage audit batch', async () => {
  process.env.CRON_SECRET = 'sek'
  const res = await GET(
    new Request('http://x', {
      headers: { authorization: 'Bearer sek' },
    }) as never
  )
  expect(sweepDoneTaskEdges).toHaveBeenCalled()
  expect(auditDoneTaskSessions).toHaveBeenCalledWith(expect.any(Number))
  const body = await res.json()
  expect(body.usage.processed).toBe(3)
})
