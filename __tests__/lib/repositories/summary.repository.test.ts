/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspaceSummary: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    projectSummary: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    workspace: {
      findMany: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { summaryRepository } from '@/lib/repositories/summary.repository'

const mockWsFindMany = prisma.workspaceSummary.findMany as jest.Mock
const mockWsCreate = prisma.workspaceSummary.create as jest.Mock
const mockPsFindMany = prisma.projectSummary.findMany as jest.Mock
const mockPsCreate = prisma.projectSummary.create as jest.Mock
const mockWorkspaceFindMany = prisma.workspace.findMany as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('summaryRepository.findWorkspaceSummaries', () => {
  it('returns summaries without cursor', async () => {
    const summaries = [{ id: 's1', tldr: 'Test' }]
    mockWsFindMany.mockResolvedValue(summaries)

    const result = await summaryRepository.findWorkspaceSummaries('ws-1', {
      limit: 10,
    })

    expect(result).toEqual(summaries)
    expect(mockWsFindMany).toHaveBeenCalledWith({
      where: { workspaceId: 'ws-1' },
      orderBy: { generatedAt: 'desc' },
      take: 10,
    })
  })

  it('applies before cursor when provided', async () => {
    mockWsFindMany.mockResolvedValue([])

    await summaryRepository.findWorkspaceSummaries('ws-1', {
      limit: 5,
      before: '2024-01-01T00:00:00Z',
    })

    expect(mockWsFindMany).toHaveBeenCalledWith({
      where: {
        workspaceId: 'ws-1',
        generatedAt: { lt: new Date('2024-01-01T00:00:00Z') },
      },
      orderBy: { generatedAt: 'desc' },
      take: 5,
    })
  })
})

describe('summaryRepository.findProjectSummaries', () => {
  it('returns project summaries', async () => {
    const summaries = [{ id: 'ps1', tldr: 'Project summary' }]
    mockPsFindMany.mockResolvedValue(summaries)

    const result = await summaryRepository.findProjectSummaries('proj-1', {
      limit: 10,
    })

    expect(result).toEqual(summaries)
    expect(mockPsFindMany).toHaveBeenCalledWith({
      where: { projectId: 'proj-1' },
      orderBy: { generatedAt: 'desc' },
      take: 10,
    })
  })
})

describe('summaryRepository.findSummaryEnabledWorkspaces', () => {
  it('finds workspaces with summaries enabled', async () => {
    const workspaces = [{ id: 'ws-1', summaryEnabled: true }]
    mockWorkspaceFindMany.mockResolvedValue(workspaces)

    const result = await summaryRepository.findSummaryEnabledWorkspaces()

    expect(result).toEqual(workspaces)
    expect(mockWorkspaceFindMany).toHaveBeenCalledWith({
      where: { summaryEnabled: true },
      include: {
        projects: {
          select: {
            id: true,
            name: true,
            description: true,
            riskOverdueRatio: true,
            riskStalledDays: true,
            riskStalledMinCount: true,
            riskAgentFailRatio: true,
            riskStalePrDays: true,
            riskThroughputDrop: true,
          },
        },
        summaries: { orderBy: { generatedAt: 'desc' }, take: 1 },
      },
    })
  })

  it('filters by workspaceId when provided', async () => {
    mockWorkspaceFindMany.mockResolvedValue([])

    await summaryRepository.findSummaryEnabledWorkspaces('ws-1')

    expect(mockWorkspaceFindMany).toHaveBeenCalledWith({
      where: { summaryEnabled: true, id: 'ws-1' },
      include: {
        projects: {
          select: {
            id: true,
            name: true,
            description: true,
            riskOverdueRatio: true,
            riskStalledDays: true,
            riskStalledMinCount: true,
            riskAgentFailRatio: true,
            riskStalePrDays: true,
            riskThroughputDrop: true,
          },
        },
        summaries: { orderBy: { generatedAt: 'desc' }, take: 1 },
      },
    })
  })
})

describe('summaryRepository.createProjectSummary', () => {
  it('creates a project summary', async () => {
    const data = {
      projectId: 'proj-1',
      stats: { tasks: 5 },
      tldr: 'Summary',
      report: 'Full report',
    }
    const created = { id: 'ps1', ...data }
    mockPsCreate.mockResolvedValue(created)

    const result = await summaryRepository.createProjectSummary(data)

    expect(result).toEqual(created)
    expect(mockPsCreate).toHaveBeenCalledWith({ data })
  })
})

describe('summaryRepository.createWorkspaceSummary', () => {
  it('creates a workspace summary', async () => {
    const data = {
      workspaceId: 'ws-1',
      stats: { total: 10 },
      tldr: 'WS Summary',
      report: 'WS Report',
    }
    const created = { id: 'ws1', ...data }
    mockWsCreate.mockResolvedValue(created)

    const result = await summaryRepository.createWorkspaceSummary(data)

    expect(result).toEqual(created)
    expect(mockWsCreate).toHaveBeenCalledWith({ data })
  })
})
