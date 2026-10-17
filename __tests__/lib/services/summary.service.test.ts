/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/summary.repository', () => ({
  summaryRepository: {
    findProjectSummaries: jest.fn(),
    createProjectSummary: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/generation-job.repository', () => ({
  generationJobRepository: {
    deleteOlderThan: jest.fn(),
  },
}))

import { summaryRepository } from '@/lib/repositories/summary.repository'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import { summaryService } from '@/lib/services/summary.service'

const mockFindPsSummaries = summaryRepository.findProjectSummaries as jest.Mock
const mockCreatePs = summaryRepository.createProjectSummary as jest.Mock
const mockDeleteOlderThan = generationJobRepository.deleteOlderThan as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('summaryService.getProjectSummaries', () => {
  it('delegates to repository', async () => {
    const summaries = [{ id: 'ps1' }]
    mockFindPsSummaries.mockResolvedValue(summaries)

    const result = await summaryService.getProjectSummaries('proj-1', {
      limit: 5,
      before: '2024-01-01',
    })

    expect(result).toEqual(summaries)
    expect(mockFindPsSummaries).toHaveBeenCalledWith('proj-1', {
      limit: 5,
      before: '2024-01-01',
    })
  })
})

describe('summaryService.createProjectSummary', () => {
  it('creates a project summary via repository', async () => {
    const created = { id: 'ps1' }
    mockCreatePs.mockResolvedValue(created)

    const result = await summaryService.createProjectSummary(
      'proj-1',
      { tasks: 5 },
      'TLDR',
      'Report'
    )

    expect(result).toEqual(created)
    expect(mockCreatePs).toHaveBeenCalledWith({
      projectId: 'proj-1',
      stats: { tasks: 5 },
      tldr: 'TLDR',
      report: 'Report',
    })
  })
})

describe('summaryService.pruneGenerationJobs (LUM-1228)', () => {
  it('drops generation jobs older than 7 days and returns the count', async () => {
    mockDeleteOlderThan.mockResolvedValue({ count: 3 })

    await expect(summaryService.pruneGenerationJobs()).resolves.toBe(3)
    expect(mockDeleteOlderThan).toHaveBeenCalledWith(7)
  })

  it('no longer exposes any workspace-briefing generation', () => {
    const svc = summaryService as unknown as Record<string, unknown>
    for (const gone of [
      'generateCronSummaries',
      'getWorkspaceSummaries',
      'createWorkspaceSummary',
      'findSummaryEnabledWorkspaces',
      'isDueForGeneration',
    ]) {
      expect(svc[gone]).toBeUndefined()
    }
  })
})
