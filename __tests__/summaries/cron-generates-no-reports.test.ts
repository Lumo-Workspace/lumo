/**
 * @jest-environment node
 */
/**
 * Cost guards on the daily summaries cron (GET /api/summaries/generate).
 *
 * LUM-699: the project-level report lost its last reader, so the cron stopped
 * generating one. LUM-1228: the workspace briefing lost its last readers too
 * (the Dashboard page and `lumo workspace overview` were removed), so the
 * cron generates nothing at all — it only prunes old generation jobs.
 *
 * Asserted as an invariant through the real route + real service (no report,
 * no stats aggregation, no summary row) rather than by inspecting the code:
 * it must stay true however the cron is refactored.
 *
 * Mock functions are created *inside* the factories and grabbed afterwards:
 * `import` is hoisted above the `const`s, so a factory closing over an outer
 * `const` would hit its temporal dead zone.
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/summaries/report', () => ({
  generateProjectReport: jest.fn(),
}))

jest.mock('@/lib/summaries/stats', () => ({
  aggregateProjectStats: jest.fn(),
}))

jest.mock('@/lib/repositories/summary.repository', () => ({
  summaryRepository: {
    createProjectSummary: jest.fn(),
    findProjectSummaries: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/generation-job.repository', () => ({
  generationJobRepository: {
    findRecentByTarget: jest.fn(async () => null),
    create: jest.fn(async () => ({ id: 'job1' })),
    updateStatus: jest.fn(async () => undefined),
    deleteOlderThan: jest.fn(async () => ({ count: 4 })),
    findById: jest.fn(),
  },
}))

import { GET } from '@/app/api/summaries/generate/route'
import { generateProjectReport } from '@/lib/summaries/report'
import { aggregateProjectStats } from '@/lib/summaries/stats'
import { summaryRepository } from '@/lib/repositories/summary.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'

const ORIGINAL_SECRET = process.env.CRON_SECRET
const CRON_VALUE = 'cron-test-value'

beforeEach(() => {
  jest.clearAllMocks()
  process.env.CRON_SECRET = CRON_VALUE
})

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = ORIGINAL_SECRET
})

function cronRequest() {
  return new NextRequest('http://localhost/api/summaries/generate', {
    method: 'GET',
    headers: { authorization: `Bearer ${CRON_VALUE}` },
  })
}

describe('GET /api/summaries/generate (daily cron)', () => {
  it('makes no LLM call and writes no summary — it only prunes old jobs', async () => {
    const res = await GET(cronRequest())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ pruned: 4 })
    expect(generationJobRepository.deleteOlderThan).toHaveBeenCalledWith(7)

    expect(generateProjectReport).not.toHaveBeenCalled()
    expect(aggregateProjectStats).not.toHaveBeenCalled()
    expect(summaryRepository.createProjectSummary).not.toHaveBeenCalled()
    expect(generationJobRepository.create).not.toHaveBeenCalled()
  })

  it('has no workspace-briefing generator left to call', async () => {
    const report = jest.requireActual('@/lib/summaries/report')
    const stats = jest.requireActual('@/lib/summaries/stats')
    expect(report.generateWorkspaceReport).toBeUndefined()
    expect(report.buildWorkspacePrompt).toBeUndefined()
    expect(stats.aggregateWorkspaceStats).toBeUndefined()
  })
})
