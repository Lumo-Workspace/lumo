import { droppedFragmentRepository } from '@/lib/repositories/dropped-fragment.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))

describe('droppedFragmentRepository.createMany', () => {
  it('maps inputs and skips when empty', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 })
    ;(prisma as any).droppedFragment = { createMany }
    expect(await droppedFragmentRepository.createMany([])).toEqual({ count: 0 })
    expect(createMany).not.toHaveBeenCalled()
    await droppedFragmentRepository.createMany([
      {
        workspaceId: 'w',
        taskId: 't',
        sessionId: 's',
        fragmentType: 'MEMORY',
        fragmentId: 'x',
        relevanceScore: 0.2,
      },
    ])
    expect(createMany.mock.calls[0][0].data[0]).toMatchObject({
      workspaceId: 'w',
      taskId: 't',
      sessionId: 's',
      fragmentType: 'MEMORY',
      fragmentId: 'x',
      relevanceScore: 0.2,
    })
  })
})
