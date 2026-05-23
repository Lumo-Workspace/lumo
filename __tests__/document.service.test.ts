import { documentService } from '@/lib/services/document.service'

// ── Mock dependencies ───────────────────────────────────────────────────────

const mockFindByWorkspace = jest.fn()
const mockFindWithPermission = jest.fn()
const mockFindById = jest.fn()
const mockGetMaxSortOrder = jest.fn()
const mockCreate = jest.fn()
const mockDeleteWithDescendants = jest.fn()
const mockUpsertEditor = jest.fn()
const mockFindMention = jest.fn()
const mockAddExplicitMention = jest.fn()
const mockRemoveExplicitMention = jest.fn()
const mockUpdateWithChildrenAndMentions = jest.fn()

jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findByWorkspace: (...args: any[]) => mockFindByWorkspace(...args),
    findWithPermission: (...args: any[]) => mockFindWithPermission(...args),
    findById: (...args: any[]) => mockFindById(...args),
    getMaxSortOrder: (...args: any[]) => mockGetMaxSortOrder(...args),
    create: (...args: any[]) => mockCreate(...args),
    deleteWithDescendants: (...args: any[]) =>
      mockDeleteWithDescendants(...args),
    upsertEditor: (...args: any[]) => mockUpsertEditor(...args),
    findNodeWithChildren: jest.fn().mockResolvedValue(null),
    findMention: (...args: any[]) => mockFindMention(...args),
    addExplicitMention: (...args: any[]) => mockAddExplicitMention(...args),
    removeExplicitMention: (...args: any[]) =>
      mockRemoveExplicitMention(...args),
    updateWithChildrenAndMentions: (...args: any[]) =>
      mockUpdateWithChildrenAndMentions(...args),
  },
}))

jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByDocument: jest.fn().mockResolvedValue([]),
    syncDocumentTags: jest.fn().mockResolvedValue(undefined),
  },
}))

jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: {
      getUserList: jest.fn().mockResolvedValue({ data: [] }),
    },
  }),
}))

const mockTaskFindFirst = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: any) =>
      fn({
        document: {
          update: jest.fn().mockResolvedValue({ id: 'doc-1' }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'doc-1' }),
        },
        documentMention: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      })
    ),
    documentMention: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    task: {
      findFirst: (...args: any[]) => mockTaskFindFirst(...args),
    },
  },
}))

beforeEach(() => jest.clearAllMocks())

// ── Tests ───────────────────────────────────────────────────────────────────

describe('documentService', () => {
  describe('listDocuments', () => {
    it('returns enriched documents from repository', async () => {
      mockFindByWorkspace.mockResolvedValue([
        {
          id: 'doc-1',
          title: 'Test',
          createdBy: { id: 'm-1', clerkId: 'clerk-1' },
          shares: [],
          editors: [],
        },
      ])

      const result = await documentService.listDocuments('ws-1', 'm-1')

      expect(result).toHaveLength(1)
      expect(result[0]!.id).toBe('doc-1')
      expect(mockFindByWorkspace).toHaveBeenCalledWith('ws-1', 'm-1', undefined)
    })

    it('passes filters to repository', async () => {
      mockFindByWorkspace.mockResolvedValue([])

      await documentService.listDocuments('ws-1', 'm-1', {
        visibility: 'PRIVATE',
        search: 'test',
      })

      expect(mockFindByWorkspace).toHaveBeenCalledWith('ws-1', 'm-1', {
        visibility: 'PRIVATE',
        search: 'test',
      })
    })
  })

  describe('getDocument', () => {
    it('throws 404 when document not found', async () => {
      mockFindWithPermission.mockResolvedValue(null)

      await expect(
        documentService.getDocument('doc-missing', 'm-1', 'ws-1')
      ).rejects.toMatchObject({
        message: 'Document not found',
        status: 404,
      })
    })

    it('returns shaped document with ancestors', async () => {
      mockFindWithPermission.mockResolvedValue({
        id: 'doc-1',
        parentId: null,
        createdBy: { id: 'm-1', clerkId: 'clerk-1' },
        shares: [],
      })

      const result = await documentService.getDocument('doc-1', 'm-1', 'ws-1')

      expect(result.document.id).toBe('doc-1')
      expect(result.ancestors).toEqual([])
    })
  })

  describe('createDocument', () => {
    it('creates document with auto-calculated sortOrder', async () => {
      mockGetMaxSortOrder.mockResolvedValue(3)
      mockCreate.mockResolvedValue({
        id: 'doc-new',
        createdBy: { id: 'm-1', clerkId: 'clerk-1' },
      })

      await documentService.createDocument('ws-1', 'm-1', {
        title: 'New Doc',
        visibility: 'WORKSPACE',
      })

      expect(mockGetMaxSortOrder).toHaveBeenCalledWith('ws-1', null)
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          sortOrder: 4,
          title: 'New Doc',
        })
      )
    })
  })

  describe('updateDocument', () => {
    it('throws 404 when document not found', async () => {
      mockFindWithPermission.mockResolvedValue(null)

      await expect(
        documentService.updateDocument('doc-missing', 'm-1', 'ws-1', {
          title: 'Updated',
        })
      ).rejects.toMatchObject({
        message: 'Document not found',
        status: 404,
      })
    })

    it('throws 403 for VIEWER role', async () => {
      mockFindWithPermission.mockResolvedValue({
        id: 'doc-1',
        createdById: 'other-member',
        shares: [{ memberId: 'm-1', role: 'VIEWER' }],
      })

      await expect(
        documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
          title: 'Updated',
        })
      ).rejects.toMatchObject({
        message: 'Permission denied',
        status: 403,
      })
    })

    it('throws 403 when non-owner changes visibility', async () => {
      mockFindWithPermission.mockResolvedValue({
        id: 'doc-1',
        createdById: 'other-member',
        shares: [{ memberId: 'm-1', role: 'EDITOR' }],
      })

      await expect(
        documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
          visibility: 'PRIVATE',
        })
      ).rejects.toMatchObject({
        message: 'Only the owner can change visibility',
        status: 403,
      })
    })

    it('throws 403 when non-owner changes publicToken', async () => {
      mockFindWithPermission.mockResolvedValue({
        id: 'doc-1',
        createdById: 'other-member',
        shares: [{ memberId: 'm-1', role: 'EDITOR' }],
      })

      await expect(
        documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
          publicToken: 'some-token',
        })
      ).rejects.toMatchObject({
        message: 'Only the owner can change public link',
        status: 403,
      })
    })
  })

  describe('deleteDocument', () => {
    it('throws 404 when document not found', async () => {
      mockFindById.mockResolvedValue(null)

      await expect(
        documentService.deleteDocument('doc-missing', 'm-1', 'ws-1')
      ).rejects.toMatchObject({
        message: 'Document not found',
        status: 404,
      })
    })

    it('throws 403 when non-owner tries to delete', async () => {
      mockFindById.mockResolvedValue({
        id: 'doc-1',
        createdById: 'other-member',
      })

      await expect(
        documentService.deleteDocument('doc-1', 'm-1', 'ws-1')
      ).rejects.toMatchObject({
        message: 'Only the owner can delete a document',
        status: 403,
      })
    })

    it('calls deleteWithDescendants for owner', async () => {
      mockFindById.mockResolvedValue({ id: 'doc-1', createdById: 'm-1' })
      mockDeleteWithDescendants.mockResolvedValue(undefined)

      await documentService.deleteDocument('doc-1', 'm-1', 'ws-1')

      expect(mockDeleteWithDescendants).toHaveBeenCalledWith('doc-1', 'ws-1')
    })
  })

  describe('getUserRole', () => {
    it('returns OWNER when memberId matches createdById', () => {
      const doc = { createdById: 'm-1', shares: [] }
      expect(documentService.getUserRole(doc, 'm-1')).toBe('OWNER')
    })

    it('returns share role when found in shares', () => {
      const doc = {
        createdById: 'other',
        shares: [{ memberId: 'm-1', role: 'EDITOR' }],
      }
      expect(documentService.getUserRole(doc, 'm-1')).toBe('EDITOR')
    })

    it('returns null when no access', () => {
      const doc = { createdById: 'other', shares: [] }
      expect(documentService.getUserRole(doc, 'm-1')).toBeNull()
    })
  })

  describe('extractTaskMentionIds', () => {
    it('extracts task mention IDs from Tiptap JSON', () => {
      const content = JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'mention',
                attrs: { mentionType: 'task', id: 'task-1' },
              },
              {
                type: 'mention',
                attrs: { mentionType: 'task', id: 'task-2' },
              },
            ],
          },
        ],
      })

      const ids = documentService.extractTaskMentionIds(content)

      expect(ids).toEqual(['task-1', 'task-2'])
    })

    it('deduplicates mention IDs', () => {
      const content = JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'mention',
                attrs: { mentionType: 'task', id: 'task-1' },
              },
              {
                type: 'mention',
                attrs: { mentionType: 'task', id: 'task-1' },
              },
            ],
          },
        ],
      })

      const ids = documentService.extractTaskMentionIds(content)

      expect(ids).toEqual(['task-1'])
    })

    it('returns empty array for null/undefined content', () => {
      expect(documentService.extractTaskMentionIds(null)).toEqual([])
      expect(documentService.extractTaskMentionIds(undefined)).toEqual([])
    })

    it('returns empty array for invalid JSON string', () => {
      expect(documentService.extractTaskMentionIds('not json')).toEqual([])
    })

    it('ignores non-task mentions', () => {
      const content = JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'mention',
                attrs: { mentionType: 'member', id: 'member-1' },
              },
            ],
          },
        ],
      })

      expect(documentService.extractTaskMentionIds(content)).toEqual([])
    })
  })
})

// ── Explicit mention tests ──────────────────────────────────────────────────

describe('documentService — explicit mentions', () => {
  const ownerDoc = {
    id: 'doc1',
    createdById: 'member1',
    shares: [],
  }

  it('addExplicitMention upgrades an existing CONTENT row to EXPLICIT', async () => {
    mockFindWithPermission.mockResolvedValue(ownerDoc)
    // resolveTask queries: { id, number, team: { identifier } }
    mockTaskFindFirst.mockResolvedValue({
      id: 'task_cuid_1',
      number: 42,
      team: { identifier: 'LUM' },
    })
    mockFindMention.mockResolvedValue({ source: 'CONTENT' })
    mockAddExplicitMention.mockResolvedValue({
      documentId: 'doc1',
      taskId: 'task_cuid_1',
      source: 'EXPLICIT',
    })

    const result = await documentService.addExplicitMention(
      'doc1',
      'LUM-42',
      'workspace1',
      'member1'
    )

    expect(result.upgradedFromContent).toBe(true)
    expect(result.source).toBe('EXPLICIT')
    expect(result.taskIdentifier).toBe('LUM-42')
  })

  it('addExplicitMention is idempotent when row is already EXPLICIT', async () => {
    mockFindWithPermission.mockResolvedValue(ownerDoc)
    mockTaskFindFirst.mockResolvedValue({
      id: 'task_cuid_1',
      number: 42,
      team: { identifier: 'LUM' },
    })
    mockFindMention.mockResolvedValue({ source: 'EXPLICIT' })
    mockAddExplicitMention.mockResolvedValue({
      documentId: 'doc1',
      taskId: 'task_cuid_1',
      source: 'EXPLICIT',
    })

    const result = await documentService.addExplicitMention(
      'doc1',
      'LUM-42',
      'workspace1',
      'member1'
    )

    expect(result.alreadyBound).toBe(true)
    expect(result.upgradedFromContent).toBe(false)
  })

  it('addExplicitMention 404s when task identifier does not resolve', async () => {
    mockFindWithPermission.mockResolvedValue(ownerDoc)
    mockTaskFindFirst.mockResolvedValue(null)

    await expect(
      documentService.addExplicitMention(
        'doc1',
        'LUM-99999',
        'workspace1',
        'member1'
      )
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Task not found/),
      status: 404,
    })
  })

  it('removeExplicitMention returns refused when row is CONTENT-only', async () => {
    mockFindWithPermission.mockResolvedValue(ownerDoc)
    mockTaskFindFirst.mockResolvedValue({
      id: 'task_cuid_1',
      number: 42,
      team: { identifier: 'LUM' },
    })
    mockFindMention.mockResolvedValue({ source: 'CONTENT' })

    const result = await documentService.removeExplicitMention(
      'doc1',
      'LUM-42',
      'workspace1',
      'member1'
    )

    expect(result.refused).toBe(true)
    expect(result.reason).toMatch(/content-derived/i)
    expect(result.removed).toBe(0)
  })

  it('removeExplicitMention returns removed=0 when no row exists', async () => {
    mockFindWithPermission.mockResolvedValue(ownerDoc)
    mockTaskFindFirst.mockResolvedValue({
      id: 'task_cuid_999',
      number: 999,
      team: { identifier: 'LUM' },
    })
    mockFindMention.mockResolvedValue(null)
    mockRemoveExplicitMention.mockResolvedValue(0)

    const result = await documentService.removeExplicitMention(
      'doc1',
      'LUM-999',
      'workspace1',
      'member1'
    )

    expect(result.removed).toBe(0)
    expect(result.refused).toBeFalsy()
  })

  it('removeExplicitMention returns removed=1 for an EXPLICIT row', async () => {
    mockFindWithPermission.mockResolvedValue(ownerDoc)
    mockTaskFindFirst.mockResolvedValue({
      id: 'task_cuid_1',
      number: 42,
      team: { identifier: 'LUM' },
    })
    mockFindMention.mockResolvedValue({ source: 'EXPLICIT' })
    mockRemoveExplicitMention.mockResolvedValue(1)

    const result = await documentService.removeExplicitMention(
      'doc1',
      'LUM-42',
      'workspace1',
      'member1'
    )

    expect(result.removed).toBe(1)
    expect(result.taskIdentifier).toBe('LUM-42')
  })
})

// ── contentMarkdown tests ───────────────────────────────────────────────────

describe('documentService — contentMarkdown', () => {
  it('createDocument with contentMarkdown stores converted Tiptap JSON', async () => {
    mockGetMaxSortOrder.mockResolvedValue(0)
    mockCreate.mockImplementation((data: any) => {
      return Promise.resolve({
        id: 'doc-new',
        content: data.content ?? null,
        createdBy: { id: 'm-1', clerkId: 'clerk-1' },
      })
    })

    const result = await documentService.createDocument('workspace1', 'member1', {
      title: 't',
      visibility: 'PRIVATE',
      contentMarkdown: '# Hello',
    })

    expect(result.content).toBeTruthy()
    const parsed = JSON.parse(result.content as string)
    expect(parsed.type).toBe('doc')
    expect(parsed.content[0].type).toBe('heading')
    expect(parsed.content[0].attrs.level).toBe(1)
  })

  it('updateDocument with contentMarkdown overwrites content', async () => {
    mockFindWithPermission.mockResolvedValue({
      id: 'doc1',
      createdById: 'member1',
      shares: [],
    })
    mockUpdateWithChildrenAndMentions.mockImplementation(
      (_id: string, updateData: any) => {
        return Promise.resolve({
          id: 'doc1',
          content: updateData.content ?? null,
        })
      }
    )
    mockUpsertEditor.mockResolvedValue(undefined)

    const result = await documentService.updateDocument(
      'doc1',
      'member1',
      'workspace1',
      { contentMarkdown: 'just text' }
    )

    const parsed = JSON.parse(result.content as string)
    expect(parsed.type).toBe('doc')
    expect(parsed.content[0].type).toBe('paragraph')
  })

  it('updateDocument rejects passing both content and contentMarkdown', async () => {
    mockFindWithPermission.mockResolvedValue({
      id: 'doc1',
      createdById: 'member1',
      shares: [],
    })

    await expect(
      documentService.updateDocument('doc1', 'member1', 'workspace1', {
        content: '{}',
        contentMarkdown: 'x',
      })
    ).rejects.toMatchObject({
      message: expect.stringMatching(/mutually exclusive/i),
      status: 400,
    })
  })
})
