/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/summary.repository', () => ({
  summaryRepository: {
    findWorkspaceSummaries: jest.fn(),
    findProjectSummaries: jest.fn(),
    findSummaryEnabledWorkspaces: jest.fn(),
    createProjectSummary: jest.fn(),
    createWorkspaceSummary: jest.fn(),
  },
}))

import { summaryRepository } from '@/lib/repositories/summary.repository'
import { summaryService } from '@/lib/services/summary.service'

const mockFindWsSummaries =
  summaryRepository.findWorkspaceSummaries as jest.Mock
const mockFindPsSummaries = summaryRepository.findProjectSummaries as jest.Mock
const mockFindEnabled =
  summaryRepository.findSummaryEnabledWorkspaces as jest.Mock
const mockCreatePs = summaryRepository.createProjectSummary as jest.Mock
const mockCreateWs = summaryRepository.createWorkspaceSummary as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('summaryService.getWorkspaceSummaries', () => {
  it('delegates to repository', async () => {
    const summaries = [{ id: 's1' }]
    mockFindWsSummaries.mockResolvedValue(summaries)

    const result = await summaryService.getWorkspaceSummaries('ws-1', {
      limit: 10,
    })

    expect(result).toEqual(summaries)
    expect(mockFindWsSummaries).toHaveBeenCalledWith('ws-1', { limit: 10 })
  })
})

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

describe('summaryService.findSummaryEnabledWorkspaces', () => {
  it('delegates to repository', async () => {
    mockFindEnabled.mockResolvedValue([])

    await summaryService.findSummaryEnabledWorkspaces('ws-1')

    expect(mockFindEnabled).toHaveBeenCalledWith('ws-1')
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

describe('summaryService.createWorkspaceSummary', () => {
  it('creates a workspace summary via repository', async () => {
    const created = { id: 'ws1' }
    mockCreateWs.mockResolvedValue(created)

    const result = await summaryService.createWorkspaceSummary(
      'ws-1',
      { total: 10 },
      'TLDR',
      'Report'
    )

    expect(result).toEqual(created)
    expect(mockCreateWs).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      stats: { total: 10 },
      tldr: 'TLDR',
      report: 'Report',
    })
  })
})

describe('summaryService.isDueForGeneration', () => {
  it('returns true when no previous generation', () => {
    expect(summaryService.isDueForGeneration('DAILY', null)).toBe(true)
  })

  it('returns true for DAILY when 25 hours have passed', () => {
    const lastGenerated = new Date(Date.now() - 25 * 60 * 60 * 1000)
    expect(summaryService.isDueForGeneration('DAILY', lastGenerated)).toBe(true)
  })

  it('returns false for DAILY when only 10 hours have passed', () => {
    const lastGenerated = new Date(Date.now() - 10 * 60 * 60 * 1000)
    expect(summaryService.isDueForGeneration('DAILY', lastGenerated)).toBe(
      false
    )
  })

  it('returns true for EVERY_TWO_DAYS when 49 hours have passed', () => {
    const lastGenerated = new Date(Date.now() - 49 * 60 * 60 * 1000)
    expect(
      summaryService.isDueForGeneration('EVERY_TWO_DAYS', lastGenerated)
    ).toBe(true)
  })

  it('returns false for EVERY_TWO_DAYS when only 24 hours have passed', () => {
    const lastGenerated = new Date(Date.now() - 24 * 60 * 60 * 1000)
    expect(
      summaryService.isDueForGeneration('EVERY_TWO_DAYS', lastGenerated)
    ).toBe(false)
  })

  it('returns true for WEEKLY when 169 hours have passed', () => {
    const lastGenerated = new Date(Date.now() - 169 * 60 * 60 * 1000)
    expect(summaryService.isDueForGeneration('WEEKLY', lastGenerated)).toBe(
      true
    )
  })

  it('returns false for WEEKLY when only 100 hours have passed', () => {
    const lastGenerated = new Date(Date.now() - 100 * 60 * 60 * 1000)
    expect(summaryService.isDueForGeneration('WEEKLY', lastGenerated)).toBe(
      false
    )
  })

  it('returns true for unknown frequency', () => {
    const lastGenerated = new Date()
    expect(summaryService.isDueForGeneration('UNKNOWN', lastGenerated)).toBe(
      true
    )
  })
})
