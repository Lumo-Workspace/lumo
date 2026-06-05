// __tests__/lib/repositories/documentComment.repository.test.ts
import { documentCommentRepository } from '@/lib/repositories/documentComment.repository'
import { prisma } from '@/lib/db/prisma'

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    documentComment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}))

const m = prisma as unknown as {
  documentComment: {
    findMany: jest.Mock
    findUnique: jest.Mock
    create: jest.Mock
    update: jest.Mock
    updateMany: jest.Mock
  }
}

beforeEach(() => jest.clearAllMocks())

describe('documentCommentRepository', () => {
  it('findByDocumentId surfaces live threads + tombstoned parents with live replies', async () => {
    // A soft-deleted parent that still has non-deleted replies must remain
    // reachable (rendered as a "[deleted]" tombstone) so its replies are not
    // orphaned. Childless soft-deleted parents stay hidden.
    m.documentComment.findMany.mockResolvedValue([])
    await documentCommentRepository.findByDocumentId('d1')
    const arg = m.documentComment.findMany.mock.calls[0]![0]
    expect(arg.where).toMatchObject({
      documentId: 'd1',
      parentId: null,
      OR: [{ deletedAt: null }, { replies: { some: { deletedAt: null } } }],
    })
    // Top-level filter must NOT hard-exclude deleted parents anymore.
    expect(arg.where.deletedAt).toBeUndefined()
    expect(arg.include.replies.where).toMatchObject({ deletedAt: null })
  })

  it('delete is a soft-delete (sets deletedAt)', async () => {
    m.documentComment.update.mockResolvedValue({})
    await documentCommentRepository.softDelete('c1')
    const arg = m.documentComment.update.mock.calls[0]![0]
    expect(arg.where).toEqual({ id: 'c1' })
    expect(arg.data.deletedAt).toBeInstanceOf(Date)
  })

  it('setStatus writes status + resolver + resolvedAt when RESOLVED', async () => {
    m.documentComment.update.mockResolvedValue({})
    await documentCommentRepository.setStatus('c1', 'RESOLVED', 'a1')
    const arg = m.documentComment.update.mock.calls[0]![0]
    expect(arg.data.status).toBe('RESOLVED')
    expect(arg.data.resolvedByActorId).toBe('a1')
    expect(arg.data.resolvedAt).toBeInstanceOf(Date)
  })

  it('setStatus clears resolver when reopening (OPEN)', async () => {
    m.documentComment.update.mockResolvedValue({})
    await documentCommentRepository.setStatus('c1', 'OPEN', 'a1')
    const arg = m.documentComment.update.mock.calls[0]![0]
    expect(arg.data.status).toBe('OPEN')
    expect(arg.data.resolvedByActorId).toBeNull()
    expect(arg.data.resolvedAt).toBeNull()
  })

  it('setOrphaned is a no-op for empty id list', async () => {
    const res = await documentCommentRepository.setOrphaned([], true)
    expect(res).toEqual({ count: 0 })
    expect(m.documentComment.updateMany).not.toHaveBeenCalled()
  })

  it('setOrphaned updates the given ids', async () => {
    m.documentComment.updateMany.mockResolvedValue({ count: 2 })
    await documentCommentRepository.setOrphaned(['c1', 'c2'], true)
    const arg = m.documentComment.updateMany.mock.calls[0]![0]
    expect(arg.where).toEqual({ id: { in: ['c1', 'c2'] } })
    expect(arg.data).toEqual({ isOrphaned: true })
  })
})
