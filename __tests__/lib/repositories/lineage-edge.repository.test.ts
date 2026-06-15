import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: { lineageEdge: { updateMany: jest.fn(), count: jest.fn() } },
}))

describe('lineageEdgeRepository.recordPull', () => {
  beforeEach(() => {
    ;(prisma.lineageEdge.updateMany as jest.Mock).mockReset()
  })

  it('stamps pulledAt for the matching unfetched edge', async () => {
    ;(prisma.lineageEdge.updateMany as jest.Mock).mockResolvedValue({
      count: 1,
    })
    const now = new Date('2026-06-14T00:00:00Z')
    const n = await lineageEdgeRepository.recordPull(
      { sessionId: 's1', fragmentType: 'MEMORY', fragmentId: 'm1' },
      now
    )
    expect(n).toBe(1)
    expect(prisma.lineageEdge.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: 's1',
        fragmentType: 'MEMORY',
        fragmentId: 'm1',
        pulledAt: null,
      },
      data: { pulledAt: now },
    })
  })

  it('returns 0 when no matching unfetched edge exists', async () => {
    ;(prisma.lineageEdge.updateMany as jest.Mock).mockResolvedValue({
      count: 0,
    })
    const now = new Date('2026-06-14T00:00:00Z')
    const n = await lineageEdgeRepository.recordPull(
      { sessionId: 's2', fragmentType: 'SESSION', fragmentId: 'sess1' },
      now
    )
    expect(n).toBe(0)
    expect(prisma.lineageEdge.updateMany).toHaveBeenCalledWith({
      where: {
        sessionId: 's2',
        fragmentType: 'SESSION',
        fragmentId: 'sess1',
        pulledAt: null,
      },
      data: { pulledAt: now },
    })
  })
})

describe('lineageEdgeRepository.createMany token/score fields', () => {
  it('persists indexTokens fullTokens and relevanceScore when present, omits when absent', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 2 })
    ;(prisma as any).lineageEdge = { createMany }
    await lineageEdgeRepository.createMany([
      {
        workspaceId: 'w',
        taskId: 't',
        fragmentType: 'MEMORY',
        fragmentId: 'a',
        disclosure: 'INDEX',
        indexTokens: 12,
        fullTokens: 300,
        relevanceScore: 0.81,
      },
      {
        workspaceId: 'w',
        taskId: 't',
        fragmentType: 'SESSION',
        fragmentId: 'b',
      },
    ])
    const data = createMany.mock.calls[0][0].data
    expect(data[0]).toMatchObject({
      indexTokens: 12,
      fullTokens: 300,
      relevanceScore: 0.81,
    })
    expect(data[1]).not.toHaveProperty('indexTokens')
    expect(data[1]).not.toHaveProperty('relevanceScore')
  })
})

describe('lineageEdgeRepository.applyUnusedVote', () => {
  it('applyUnusedVote marks used false only where currently null', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 })
    ;(prisma as any).lineageEdge = { updateMany }
    await lineageEdgeRepository.applyUnusedVote('s', [
      { fragmentType: 'MEMORY', fragmentId: 'b' },
    ])
    const arg = updateMany.mock.calls[0][0]
    expect(arg.where).toMatchObject({ sessionId: 's', used: null })
    expect(arg.where.OR).toEqual([{ fragmentType: 'MEMORY', fragmentId: 'b' }])
    expect(arg.data).toMatchObject({ used: false })
  })
})

describe('lineageEdgeRepository.disclosureFunnelAggregates', () => {
  it('issues four workspace-scoped counts and returns the funnel shape', async () => {
    const count = jest.fn()
    ;(prisma.lineageEdge as unknown as { count: jest.Mock }).count = count
    count
      .mockResolvedValueOnce(277) // impressions
      .mockResolvedValueOnce(277) // index
      .mockResolvedValueOnce(0) // pulled
      .mockResolvedValueOnce(12) // used

    const res = await lineageEdgeRepository.disclosureFunnelAggregates('ws-1')

    expect(res).toEqual({ impressions: 277, index: 277, pulled: 0, used: 12 })
    expect(count).toHaveBeenNthCalledWith(1, { where: { workspaceId: 'ws-1' } })
    expect(count).toHaveBeenNthCalledWith(2, {
      where: { workspaceId: 'ws-1', disclosure: 'INDEX' },
    })
    expect(count).toHaveBeenNthCalledWith(3, {
      where: {
        workspaceId: 'ws-1',
        disclosure: 'INDEX',
        pulledAt: { not: null },
      },
    })
    expect(count).toHaveBeenNthCalledWith(4, {
      where: { workspaceId: 'ws-1', used: true },
    })
  })
})
