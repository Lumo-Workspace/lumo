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

jest.mock('@/lib/repositories/summary.repository', () => {
  const project = (id: string) => ({
    id,
    name: id.toUpperCase(),
    description: null,
  })
  return {
    summaryRepository: {
      findSummaryEnabledWorkspaces: jest.fn(async () => [
        {
          id: 'ws1',
          name: 'WS',
          summaryFrequency: 'DAILY',
          defaultLocale: 'zh-CN',
          summaries: [],
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

  it('aggregates the workspace by id alone', async () => {
    await summaryService.generateCronSummaries()

    // LUM-709 removed the per-project risk overrides that used to ride along
    // with the aggregation call — the workspace id is now the whole input.
    expect(mocked.workspaceStats.mock.calls[0]).toEqual(['ws1'])
  })

  it('writes the report in the workspace default language (LUM-1117)', async () => {
    await summaryService.generateCronSummaries()

    expect(mocked.workspaceReport).toHaveBeenCalledWith(expect.anything(), {
      workspaceName: 'WS',
      locale: 'zh-CN',
    })
  })
})
