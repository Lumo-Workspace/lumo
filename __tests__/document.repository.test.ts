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

// Dedicated mocks for documentMention methods (used by explicit-mention tests)
const mockMentionUpsert = jest.fn()
const mockMentionDeleteMany = jest.fn()
const mockMentionFindMany = jest.fn()
const mockMentionCreateMany = jest.fn()
const mockMentionFindUnique = jest.fn()
const mockWorkspaceUpdate = jest.fn()

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
      upsert: (...args: any[]) => mockMentionUpsert(...args),
      deleteMany: (...args: any[]) => mockMentionDeleteMany(...args),
      findMany: (...args: any[]) => mockMentionFindMany(...args),
      createMany: (...args: any[]) => mockMentionCreateMany(...args),
      findUnique: (...args: any[]) => mockMentionFindUnique(...args),
    },
    documentShare: {
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
    },
    documentEditor: {
      upsert: (...args: any[]) => mockUpsert(...args),
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
    },
    workspace: {
      update: (...args: any[]) => mockWorkspaceUpdate(...args),
    },
    $transaction: jest.fn((fn: any) =>
      fn({
        document: {
          findMany: (...args: any[]) => mockFindMany(...args),
          create: (...args: any[]) => mockCreate(...args),
          delete: (...args: any[]) => mockDelete(...args),
        },
        documentMention: {
          findMany: (...args: any[]) => mockMentionFindMany(...args),
          deleteMany: (...args: any[]) => mockDeleteMany(...args),
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
          update: jest.fn().mockResolvedValue({}),
        },
        documentShare: {
          deleteMany: (...args: any[]) => mockDeleteMany(...args),
        },
        documentEditor: {
          deleteMany: (...args: any[]) => mockDeleteMany(...args),
        },
        workspace: {
          update: (...args: any[]) => mockWorkspaceUpdate(...args),
        },
      })
    ),
  },
}))

beforeEach(() => {
  jest.clearAllMocks()
})

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
      const callArg = mockFindFirst.mock.calls[0][0]
      expect(callArg.where.workspaceId).toBe('ws-1')
      expect(callArg.where.AND[0]).toEqual({
        OR: [{ id: 'doc-1' }, { slug: 'doc-1' }],
      })
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

    it('passes mentions include so doc show can display linked tasks', async () => {
      const fakeDoc = {
        id: 'doc-1',
        title: 'Test',
        mentions: [
          {
            task: {
              id: 'task-1',
              number: 42,
              team: { identifier: 'LUM' },
            },
          },
        ],
      }
      mockFindFirst.mockResolvedValue(fakeDoc)

      const result = await documentRepository.findWithPermission(
        'doc-1',
        'member-1',
        'ws-1'
      )

      expect(result).toEqual(fakeDoc)
      // Verify that the include contains the mentions relation
      const callArg = mockFindFirst.mock.calls[0][0]
      expect(callArg.include).toHaveProperty('mentions')
      expect(callArg.include.mentions).toHaveProperty('include')
      expect(callArg.include.mentions.include).toHaveProperty('task')
    })
  })

  describe('create', () => {
    it('creates document with correct data', async () => {
      mockWorkspaceUpdate.mockResolvedValue({ documentSeq: 1 })
      const fakeDoc = { id: 'doc-new', title: 'New Doc', number: 1 }
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

    it('creates document with optional content field when provided', async () => {
      mockWorkspaceUpdate.mockResolvedValue({ documentSeq: 1 })
      const fakeDoc = {
        id: 'doc-new',
        title: 'New Doc',
        content: '{"type":"doc"}',
      }
      mockCreate.mockResolvedValue(fakeDoc)

      await documentRepository.create({
        title: 'New Doc',
        workspaceId: 'ws-1',
        createdById: 'member-1',
        visibility: 'WORKSPACE',
        sortOrder: 1,
        content: '{"type":"doc"}',
      })

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            content: '{"type":"doc"}',
          }),
        })
      )
    })

    it('allocates per-workspace number and writes derived slug', async () => {
      mockWorkspaceUpdate.mockResolvedValue({ documentSeq: 12 })
      mockCreate.mockResolvedValue({ id: 'doc-new', title: 'Design Spec' })

      await documentRepository.create({
        title: 'Design Spec',
        workspaceId: 'ws-1',
        createdById: 'member-1',
        visibility: 'WORKSPACE',
        sortOrder: 1,
      })

      expect(mockWorkspaceUpdate).toHaveBeenCalledWith({
        where: { id: 'ws-1' },
        data: { documentSeq: { increment: 1 } },
        select: { documentSeq: true },
      })
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            number: 12,
            slug: 'design-spec-12',
          }),
        })
      )
    })

    it('falls back to "untitled" prefix when title is empty', async () => {
      mockWorkspaceUpdate.mockResolvedValue({ documentSeq: 7 })
      mockCreate.mockResolvedValue({ id: 'doc-new', title: '' })

      await documentRepository.create({
        title: '',
        workspaceId: 'ws-1',
        createdById: 'member-1',
        visibility: 'PRIVATE',
        sortOrder: 1,
      })

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            number: 7,
            slug: 'untitled-7',
          }),
        })
      )
    })
  })

  describe('slug-form lookup', () => {
    it('findWithPermission resolves a slug-shaped segment', async () => {
      mockFindFirst.mockResolvedValue({ id: 'doc-1' })

      await documentRepository.findWithPermission(
        'design-spec-12',
        'member-1',
        'ws-1'
      )

      const callArg = mockFindFirst.mock.calls[0][0]
      expect(callArg.where.workspaceId).toBe('ws-1')
      expect(callArg.where.AND[0]).toEqual({
        OR: [{ id: 'design-spec-12' }, { slug: 'design-spec-12' }],
      })
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

// ── Explicit-mention CRUD tests ──────────────────────────────────────────────

describe('documentRepository — explicit mentions', () => {
  it('addExplicitMention upserts a row with source EXPLICIT', async () => {
    const fakeRow = {
      id: 'mention-1',
      documentId: 'doc1',
      taskId: 'task1',
      source: 'EXPLICIT',
      createdAt: new Date(),
    }
    mockMentionUpsert.mockResolvedValue(fakeRow)

    const row = await documentRepository.addExplicitMention('doc1', 'task1')

    expect(row.source).toBe('EXPLICIT')
    expect(mockMentionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { documentId_taskId: { documentId: 'doc1', taskId: 'task1' } },
        create: { documentId: 'doc1', taskId: 'task1', source: 'EXPLICIT' },
        update: { source: 'EXPLICIT' },
      })
    )
  })

  it('removeExplicitMention only deletes EXPLICIT rows', async () => {
    mockMentionDeleteMany.mockResolvedValue({ count: 1 })

    const deleted = await documentRepository.removeExplicitMention(
      'doc1',
      'task1'
    )

    expect(deleted).toBe(1)
    expect(mockMentionDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { documentId: 'doc1', taskId: 'task1', source: 'EXPLICIT' },
      })
    )
  })

  it('removeExplicitMention returns 0 when no EXPLICIT row matches', async () => {
    mockMentionDeleteMany.mockResolvedValue({ count: 0 })

    const deleted = await documentRepository.removeExplicitMention(
      'doc-with-content-mention',
      'task1'
    )

    expect(deleted).toBe(0)
  })
})

// ── Source-aware sync tests ──────────────────────────────────────────────────

describe('documentRepository — sync preserves EXPLICIT', () => {
  it('updateWithChildrenAndMentions deletes only CONTENT rows when content-derived sync runs', async () => {
    // Dedicated per-call mocks so we can assert on each call separately
    const txDocUpdate = jest.fn().mockResolvedValue({ id: 'doc1' })
    const txMentionFindMany = jest.fn()
    const txMentionDeleteMany = jest.fn().mockResolvedValue({ count: 1 })
    const txMentionCreateMany = jest.fn().mockResolvedValue({ count: 1 })

    // First findMany call: source=CONTENT rows → [t1]
    // Second findMany call: all rows → [t1 (CONTENT), t2 (EXPLICIT)]
    txMentionFindMany
      .mockResolvedValueOnce([{ taskId: 't1' }]) // CONTENT rows
      .mockResolvedValueOnce([{ taskId: 't1' }, { taskId: 't2' }]) // all rows

    // Override $transaction for this test to use per-call mocks
    const { prisma } = jest.requireMock('@/lib/db/prisma') as {
      prisma: { $transaction: jest.Mock }
    }
    prisma.$transaction.mockImplementationOnce((fn: any) =>
      fn({
        document: {
          update: txDocUpdate,
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'doc1' }),
        },
        documentMention: {
          findMany: txMentionFindMany,
          deleteMany: txMentionDeleteMany,
          createMany: txMentionCreateMany,
        },
      })
    )

    await documentRepository.updateWithChildrenAndMentions(
      'doc1',
      'ws1',
      {},
      undefined,
      ['t3']
    )

    // deleteMany was called with source: 'CONTENT' and only t1 (not t2)
    expect(txMentionDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          documentId: 'doc1',
          taskId: { in: ['t1'] },
          source: 'CONTENT',
        }),
      })
    )

    // createMany was called with t3 as source: 'CONTENT' (t2 was skipped — already exists)
    expect(txMentionCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ documentId: 'doc1', taskId: 't3', source: 'CONTENT' }],
      })
    )

    // t2 was never in a deleteMany call
    const deleteCalls = txMentionDeleteMany.mock.calls
    const deletedIds = deleteCalls.flatMap(
      (c: any[]) => c[0]?.where?.taskId?.in ?? []
    )
    expect(deletedIds).not.toContain('t2')
  })
})
