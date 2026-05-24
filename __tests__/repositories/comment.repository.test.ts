import { commentRepository } from '@/lib/repositories/comment.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    comment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
  },
}))

describe('commentRepository', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('delete (soft)', () => {
    it('sets deletedAt instead of hard-deleting', async () => {
      ;(prisma.comment.update as jest.Mock).mockResolvedValue({
        id: 'c1',
        deletedAt: new Date(),
      })
      await commentRepository.delete('c1')
      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { deletedAt: expect.any(Date) },
      })
    })
  })

  describe('findByTaskId', () => {
    it('filters out soft-deleted comments and replies', async () => {
      await commentRepository.findByTaskId('t1')
      expect(prisma.comment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { taskId: 't1', parentId: null, deletedAt: null },
          include: {
            replies: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        })
      )
    })
  })

  describe('findById', () => {
    it('returns soft-deleted rows (callers decide policy)', async () => {
      ;(prisma.comment.findUnique as jest.Mock).mockResolvedValue({
        id: 'c1',
        deletedAt: new Date(),
      })
      const r = await commentRepository.findById('c1')
      expect(r?.deletedAt).toBeInstanceOf(Date)
    })
  })
})
