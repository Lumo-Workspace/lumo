import { documentRevisionRepository } from '@/lib/repositories/documentRevision.repository'

const mockCreate = jest.fn()
const mockFindFirst = jest.fn()
const mockFindMany = jest.fn()
const mockUpdate = jest.fn()
const mockDeleteMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    documentRevision: {
      create: (...a: any[]) => mockCreate(...a),
      findFirst: (...a: any[]) => mockFindFirst(...a),
      findMany: (...a: any[]) => mockFindMany(...a),
      update: (...a: any[]) => mockUpdate(...a),
      deleteMany: (...a: any[]) => mockDeleteMany(...a),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

describe('documentRevisionRepository', () => {
  it('create maps defaults for optional fields', async () => {
    mockCreate.mockResolvedValue({ id: 'r1' })
    await documentRevisionRepository.create({
      documentId: 'd1',
      workspaceId: 'w1',
      authorId: 'm1',
      content: '<p>hi</p>',
      title: 'T',
      emoji: null,
    })
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        documentId: 'd1',
        workspaceId: 'w1',
        authorId: 'm1',
        content: '<p>hi</p>',
        title: 'T',
        emoji: null,
        label: null,
        isManual: false,
        wordCount: null,
      },
    })
  })

  it('findLatestForDocument orders by createdAt desc', async () => {
    mockFindFirst.mockResolvedValue({ id: 'r9' })
    const r = await documentRevisionRepository.findLatestForDocument('d1')
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { documentId: 'd1' },
      orderBy: { createdAt: 'desc' },
    })
    expect(r).toEqual({ id: 'r9' })
  })

  it('listByDocument selects metadata only (no content)', async () => {
    mockFindMany.mockResolvedValue([])
    await documentRevisionRepository.listByDocument('d1')
    const arg = mockFindMany.mock.calls[0][0]
    expect(arg.where).toEqual({ documentId: 'd1' })
    expect(arg.orderBy).toEqual({ createdAt: 'desc' })
    expect(arg.select.content).toBeUndefined()
    expect(arg.select.id).toBe(true)
    expect(arg.select.author).toBeDefined()
  })

  it('deleteByIds is a no-op for empty input', async () => {
    const res = await documentRevisionRepository.deleteByIds([])
    expect(mockDeleteMany).not.toHaveBeenCalled()
    expect(res).toEqual({ count: 0 })
  })
})
