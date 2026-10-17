jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn().mockImplementation(() => ({})),
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    workspace: { findUnique: jest.fn() },
    project: { findUnique: jest.fn(), findMany: jest.fn() },
  },
}))

// getProjectStats reconciles drifted PR state before aggregating; no
// candidates here, so the reconcile is a no-op and never reaches GitHub.
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: {
    findStaleOpenByProject: jest.fn(async () => []),
    updateState: jest.fn(),
  },
}))

jest.mock('@/lib/summaries/stats', () => ({
  aggregateProjectStats: jest.fn(),
}))

import { getProjectStats } from '@/lib/services/stats.service'
import { prisma } from '@/lib/db/prisma'
import { aggregateProjectStats } from '@/lib/summaries/stats'

const asMock = (fn: unknown): jest.Mock => fn as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('getProjectStats', () => {
  it('returns aggregated stats for the project', async () => {
    asMock(prisma.project.findUnique).mockResolvedValue({ id: 'proj-1' })
    asMock(prisma.workspace.findUnique).mockResolvedValue({ id: 'ws-1' })
    const mockStats = { totalTasks: 10 }
    asMock(aggregateProjectStats).mockResolvedValue(mockStats)

    const result = await getProjectStats('proj-1', 'ws-1')

    expect(aggregateProjectStats).toHaveBeenCalledWith('proj-1')
    expect(result).toEqual(mockStats)
  })

  it('throws if project not found', async () => {
    asMock(prisma.project.findUnique).mockResolvedValue(null)
    asMock(prisma.workspace.findUnique).mockResolvedValue({ id: 'ws-1' })

    await expect(getProjectStats('bad', 'ws-1')).rejects.toThrow(
      'Project not found'
    )
  })
})
