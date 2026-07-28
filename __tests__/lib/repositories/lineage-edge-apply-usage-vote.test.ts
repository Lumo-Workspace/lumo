import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: { lineageEdge: { updateMany: jest.fn() } },
}))

const updateMany = prisma.lineageEdge.updateMany as jest.Mock

describe('applyUsageVote', () => {
  beforeEach(() => updateMany.mockReset().mockResolvedValue({ count: 1 }))

  const ref = { fragmentType: 'MEMORY' as const, fragmentId: 'm1' }

  it('replace mode (default) stamps true on voted and false on the rest', async () => {
    await lineageEdgeRepository.applyUsageVote('s1', [ref])
    expect(updateMany).toHaveBeenCalledTimes(2)
    const falseCall = updateMany.mock.calls.find(c => c[0].data.used === false)
    expect(falseCall).toBeTruthy()
    expect(falseCall![0].where).toMatchObject({
      sessionId: 's1',
      NOT: expect.anything(),
    })
  })

  it('additive mode stamps true on voted and NEVER writes false', async () => {
    await lineageEdgeRepository.applyUsageVote('s1', [ref], {
      mode: 'additive',
    })
    expect(updateMany).toHaveBeenCalledTimes(1)
    const call = updateMany.mock.calls[0]![0]
    expect(call.data).toEqual({ used: true, usedAt: expect.any(Date) })
    expect(call.where).toMatchObject({ sessionId: 's1', OR: [ref] })
  })

  it('additive mode with empty refs is a no-op (no writes at all)', async () => {
    const r = await lineageEdgeRepository.applyUsageVote('s1', [], {
      mode: 'additive',
    })
    expect(updateMany).not.toHaveBeenCalled()
    expect(r).toEqual({ used: 0, unused: 0 })
  })

  it('replace mode with empty refs stamps everything false (unchanged behavior)', async () => {
    updateMany.mockResolvedValue({ count: 3 })
    const r = await lineageEdgeRepository.applyUsageVote('s1', [])
    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany.mock.calls[0]![0].data).toEqual({
      used: false,
      usedAt: expect.any(Date),
    })
    expect(r).toEqual({ used: 0, unused: 3 })
  })
})
