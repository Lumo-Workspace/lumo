import { documentRepository } from '@/lib/repositories/document.repository'

// ── Mock Prisma ─────────────────────────────────────────────────────────────

const mockFindMany = jest.fn()
const mockFindFirst = jest.fn()
const mockFindUnique = jest.fn()
const mockCreate = jest.fn()
const mockUpdate = jest.fn()
const mockDelete = jest.fn()
const mockDeleteMany = jest.fn()
const mockUpsert = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    document: {
      findMany: (...args: any[]) => mockFindMany(...args),
      findFirst: (...args: any[]) => mockFindFirst(...args),
      findUnique: (...args: any[]) => mockFindUnique(...args),
      create: (...args: any[]) => mockCreate(...args),
      update: (...args: any[]) => mockUpdate(...args),
      delete: (...args: any[]) => mockDelete(...args),
    },
    documentMention: {
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
    },
    documentShare: {
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
    },
    documentEditor: {
      upsert: (...args: any[]) => mockUpsert(...args),
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
    },
    $transaction: jest.fn((fn: any) =>
      fn({
        document: {
          findMany: (...args: any[]) => mockFindMany(...args),
          delete: (...args: any[]) => mockDelete(...args),
        },
        documentMention: {
          deleteMany: (...args: any[]) => mockDeleteMany(...args),
        },
        documentShare: {
          deleteMany: (...args: any[]) => mockDeleteMany(...args),
        },
        documentEditor: {
          deleteMany: (...args: any[]) => mockDeleteMany(...args),
        },
      })
    ),
  },
}))

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────

describe('documentRepository', () => {
  describe('findByWorkspace', () => {
    it('queries with permission filter (owner, workspace-visible, or shared)', async () => {
      mockFindMany.mockResolvedValue([])

      await documentRepository.findByWorkspace('ws-1', 'member-1')

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: 'ws-1',
            OR: [
              { createdById: 'member-1' },
              { visibility: 'WORKSPACE' },
              { shares: { some: { memberId: 'member-1' } } },
            ],
          }),
        })
      )
    })

    it('applies PRIVATE visibility filter correctly', async () => {
      mockFindMany.mockResolvedValue([])

      await documentRepository.findByWorkspace('ws-1', 'member-1', {
        visibility: 'PRIVATE',
      })

      const call = mockFindMany.mock.calls[0][0]
      expect(call.where.visibility).toBe('PRIVATE')
      expect(call.where.createdById).toBe('member-1')
      expect(call.where.OR).toBeUndefined()
    })

    it('applies search filter as case-insensitive title match', async () => {
      mockFindMany.mockResolvedValue([])

      await documentRepository.findByWorkspace('ws-1', 'member-1', {
        search: 'hello',
      })

      const call = mockFindMany.mock.calls[0][0]
      expect(call.where.title).toEqual({
        contains: 'hello',
        mode: 'insensitive',
      })
    })
  })

  describe('findWithPermission', () => {
    it('returns document when user has access', async () => {
      const fakeDoc = { id: 'doc-1', title: 'Test' }
      mockFindFirst.mockResolvedValue(fakeDoc)

      const result = await documentRepository.findWithPermission(
        'doc-1',
        'member-1',
        'ws-1'
      )

      expect(result).toEqual(fakeDoc)
      expect(mockFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'doc-1',
            workspaceId: 'ws-1',
          }),
        })
      )
    })

    it('returns null when document not found', async () => {
      mockFindFirst.mockResolvedValue(null)

      const result = await documentRepository.findWithPermission(
        'doc-nonexistent',
        'member-1',
        'ws-1'
      )

      expect(result).toBeNull()
    })
  })

  describe('create', () => {
    it('creates document with correct data', async () => {
      const fakeDoc = { id: 'doc-new', title: 'New Doc' }
      mockCreate.mockResolvedValue(fakeDoc)

      const result = await documentRepository.create({
        title: 'New Doc',
        workspaceId: 'ws-1',
        createdById: 'member-1',
        visibility: 'WORKSPACE',
        sortOrder: 1,
      })

      expect(result).toEqual(fakeDoc)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: 'New Doc',
            workspaceId: 'ws-1',
            createdById: 'member-1',
            visibility: 'WORKSPACE',
            sortOrder: 1,
            emoji: null,
            parentId: null,
            projectId: null,
          }),
        })
      )
    })
  })

  describe('getMaxSortOrder', () => {
    it('returns max sortOrder from siblings', async () => {
      mockFindFirst.mockResolvedValue({ sortOrder: 5 })

      const result = await documentRepository.getMaxSortOrder('ws-1', null)

      expect(result).toBe(5)
    })

    it('returns 0 when no siblings exist', async () => {
      mockFindFirst.mockResolvedValue(null)

      const result = await documentRepository.getMaxSortOrder(
        'ws-1',
        'parent-1'
      )

      expect(result).toBe(0)
    })
  })
})
