/**
 * LUM-699 cost guard. The project-level report lost its last reader when the
 * Signal tab stopped rendering prose, so the cron no longer generates one — an
 * LLM call per project per cycle whose only consumer was the database.
 *
 * Asserted as an invariant (the generation does NOT happen) rather than by
 * inspecting the code: it must stay true however the cron is refactored.
 *
 * Mock functions are created *inside* the factories and grabbed afterwards:
 * `import` is hoisted above the `const`s, so a factory closing over an outer
 * `const` would hit its temporal dead zone.
 */

jest.mock('@/lib/summaries/report', () => ({
  generateProjectReport: jest.fn(),
  generateWorkspaceReport: jest.fn(async () => ({
    tldr: 'tldr',
    report: 'report',
  })),
}))

jest.mock('@/lib/summaries/stats', () => ({
  aggregateProjectStats: jest.fn(),
  aggregateWorkspaceStats: jest.fn(async () => ({ totalTasks: 0 })),
}))

jest.mock('@/lib/summaries/risk', () => ({
  resolveEffectiveRiskConfig: () => ({}),
}))

jest.mock('@/lib/repositories/summary.repository', () => {
  const project = (id: string) => ({
    id,
    name: id.toUpperCase(),
    description: null,
    riskOverdueRatio: null,
    riskStalledDays: null,
    riskStalledMinCount: null,
    riskAgentFailRatio: null,
    riskStalePrDays: null,
    riskThroughputDrop: null,
  })
  return {
    summaryRepository: {
      findSummaryEnabledWorkspaces: jest.fn(async () => [
        {
          id: 'ws1',
          name: 'WS',
          summaryFrequency: 'DAILY',
          summaryLocale: 'en',
          summaries: [],
          riskOverdueRatio: 0.3,
          riskStalledDays: 7,
          riskStalledMinCount: 3,
          riskAgentFailRatio: 0.3,
          riskStalePrDays: 3,
          riskThroughputDrop: 0.5,
          projects: [project('p1'), project('p2')],
        },
      ]),
      createProjectSummary: jest.fn(),
      createWorkspaceSummary: jest.fn(async () => ({ id: 'ws-summary-1' })),
      findWorkspaceSummaries: jest.fn(),
      findProjectSummaries: jest.fn(),
    },
  }
})

jest.mock('@/lib/repositories/generation-job.repository', () => ({
  generationJobRepository: {
    findRecentByTarget: jest.fn(async () => null),
    create: jest.fn(async () => ({ id: 'job1' })),
    updateStatus: jest.fn(async () => undefined),
    deleteOlderThan: jest.fn(async () => undefined),
    findById: jest.fn(),
  },
}))

import { summaryService } from '@/lib/services/summary.service'
import {
  generateProjectReport,
  generateWorkspaceReport,
} from '@/lib/summaries/report'
import {
  aggregateProjectStats,
  aggregateWorkspaceStats,
} from '@/lib/summaries/stats'
import { summaryRepository } from '@/lib/repositories/summary.repository'

const mocked = {
  projectReport: generateProjectReport as jest.Mock,
  workspaceReport: generateWorkspaceReport as jest.Mock,
  projectStats: aggregateProjectStats as jest.Mock,
  workspaceStats: aggregateWorkspaceStats as jest.Mock,
  createProjectSummary: summaryRepository.createProjectSummary as jest.Mock,
}

describe('generateCronSummaries', () => {
  beforeEach(() => jest.clearAllMocks())

  it('generates no project reports, only the workspace one', async () => {
    await summaryService.generateCronSummaries()

    // The workspace report — still rendered on the Dashboard — is unaffected.
    expect(mocked.workspaceReport).toHaveBeenCalledTimes(1)

    // Nothing project-level: no stats aggregation, no LLM call, no row written,
    // for either of the two projects in the fixture workspace.
    expect(mocked.projectReport).not.toHaveBeenCalled()
    expect(mocked.projectStats).not.toHaveBeenCalled()
    expect(mocked.createProjectSummary).not.toHaveBeenCalled()
  })

  it('still feeds every project risk override into the workspace aggregation', async () => {
    await summaryService.generateCronSummaries()

    // Dropping report generation must not drop the overrides that rode along
    // with it — those still shape the workspace risk numbers.
    const overrides = mocked.workspaceStats.mock.calls[0]?.[2] as Map<
      string,
      unknown
    >
    expect([...overrides.keys()].sort()).toEqual(['p1', 'p2'])
  })
})
