/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/services/lineage-outcome.service', () => ({
  lineageOutcomeService: { sweepDoneTaskEdges: jest.fn() },
}))

jest.mock('@/lib/services/lineage/fragment-usage-audit.service', () => ({
  fragmentUsageAuditService: { auditDoneTaskSessions: jest.fn() },
}))

jest.mock('@/lib/services/memory/compaction.service', () => ({
  memoryCompactionService: { sweepColdProjectMemories: jest.fn() },
}))

import {
  GET,
  maxDuration,
} from '@/app/api/cron/backfill-lineage-outcomes/route'
import { lineageOutcomeService } from '@/lib/services/lineage-outcome.service'
import { fragmentUsageAuditService } from '@/lib/services/lineage/fragment-usage-audit.service'
import { memoryCompactionService } from '@/lib/services/memory/compaction.service'

const mockSweep = lineageOutcomeService.sweepDoneTaskEdges as jest.Mock
const mockAudit = fragmentUsageAuditService.auditDoneTaskSessions as jest.Mock
const mockCompaction =
  memoryCompactionService.sweepColdProjectMemories as jest.Mock

const OLD_ENV = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...OLD_ENV, CRON_SECRET: 'secret' }
})
afterAll(() => {
  process.env = OLD_ENV
})

function req(auth?: string) {
  return new NextRequest('http://localhost/api/cron/backfill-lineage-outcomes', {
    headers: auth ? { authorization: auth } : {},
  })
}

it('rejects an unauthorized request', async () => {
  const res = await GET(req('Bearer wrong'))
  expect(res.status).toBe(401)
  expect(mockSweep).not.toHaveBeenCalled()
})

it('rejects a request with no authorization header', async () => {
  const res = await GET(req())
  expect(res.status).toBe(401)
  expect(mockSweep).not.toHaveBeenCalled()
})

it('runs the sweep for an authorized cron request', async () => {
  mockSweep.mockResolvedValue({ count: 546 })
  mockAudit.mockResolvedValue({ processed: 12 })
  mockCompaction.mockResolvedValue({
    projectsOverThreshold: 1,
    archivedTotal: 10,
    projects: [],
  })
  const res = await GET(req('Bearer secret'))
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({
    outcomes: { count: 546 },
    usage: { processed: 12 },
    compaction: { projectsOverThreshold: 1, archivedTotal: 10, projects: [] },
  })
  expect(mockSweep).toHaveBeenCalledTimes(1)
  expect(mockAudit).toHaveBeenCalledTimes(1)
  expect(mockCompaction).toHaveBeenCalledTimes(1)
})

it('runs compaction before the LLM usage audit so a slow audit cannot starve it', async () => {
  mockSweep.mockResolvedValue({ count: 0 })
  mockAudit.mockResolvedValue({ processed: 0 })
  mockCompaction.mockResolvedValue({
    projectsOverThreshold: 0,
    archivedTotal: 0,
    projects: [],
  })
  await GET(req('Bearer secret'))
  const compactionOrder = mockCompaction.mock.invocationCallOrder[0] as number
  const auditOrder = mockAudit.mock.invocationCallOrder[0] as number
  expect(compactionOrder).toBeLessThan(auditOrder)
})

it('declares an extended maxDuration so the audit segment gets budget beyond the fluid default', () => {
  expect(maxDuration).toBe(800)
})
