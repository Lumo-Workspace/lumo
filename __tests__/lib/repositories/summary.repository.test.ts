/**
 * @jest-environment node
 */

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    projectSummary: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { summaryRepository } from '@/lib/repositories/summary.repository'

const mockPsFindMany = prisma.projectSummary.findMany as jest.Mock
const mockPsCreate = prisma.projectSummary.create as jest.Mock

beforeEach(() => jest.clearAllMocks())

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
