import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: { lineageEdge: { findMany: jest.fn(), groupBy: jest.fn() } },
}))

describe('findVotedSessionIds', () => {
  it('returns the set of session ids that already have any usedAt-stamped edge', async () => {
    ;(prisma.lineageEdge.findMany as jest.Mock).mockResolvedValue([
      { sessionId: 's1' },
    ])
    const out = await lineageEdgeRepository.findVotedSessionIds(['s1', 's2'])
    expect(out).toEqual(new Set(['s1']))
    expect(
      (prisma.lineageEdge.findMany as jest.Mock).mock.calls[0][0].where
    ).toMatchObject({
      sessionId: { in: ['s1', 's2'] },
      usedAt: { not: null },
    })
  })

  it('returns empty set without querying for empty input', async () => {
    ;(prisma.lineageEdge.findMany as jest.Mock).mockClear()
    const out = await lineageEdgeRepository.findVotedSessionIds([])
    expect(out).toEqual(new Set())
    expect(prisma.lineageEdge.findMany).not.toHaveBeenCalled()
  })
})

describe('listUnvotedSessionIdsForDoneTasks', () => {
  it('returns distinct session ids of DONE-task edges with no usedAt, capped by limit', async () => {
    ;(prisma.lineageEdge.groupBy as jest.Mock).mockResolvedValue([
      { sessionId: 'a' },
      { sessionId: 'b' },
    ])
    const out =
      await lineageEdgeRepository.listUnvotedSessionIdsForDoneTasks(50)
    expect(out).toEqual(['a', 'b'])
    const arg = (prisma.lineageEdge.groupBy as jest.Mock).mock.calls[0][0]
    expect(arg.by).toEqual(['sessionId'])
    expect(arg.where).toMatchObject({
      sessionId: { not: null },
      usedAt: null,
      task: { status: 'DONE' },
    })
    expect(arg.take).toBe(50)
  })

  it('LUM-1338: leaves out workspaces that switched the feature off, in the query', async () => {
    ;(prisma.lineageEdge.groupBy as jest.Mock).mockResolvedValue([])
    await lineageEdgeRepository.listUnvotedSessionIdsForDoneTasks(
      50,
      undefined,
      { skipFeatureOff: 'memoryConsolidation' }
    )
    const calls = (prisma.lineageEdge.groupBy as jest.Mock).mock.calls
    const arg = calls[calls.length - 1][0]
    expect(arg.where.task.project.workspace.NOT).toEqual({
      OR: [
        { aiFeatureSwitches: { path: ['master'], equals: false } },
        { aiFeatureSwitches: { path: ['groups', 'memory'], equals: false } },
        {
          aiFeatureSwitches: {
            path: ['features', 'memoryConsolidation'],
            equals: false,
          },
        },
      ],
    })
  })
})
