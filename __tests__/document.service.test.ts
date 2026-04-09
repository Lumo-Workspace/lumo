import { documentService } from '@/lib/services/document.service'

// ── Mock dependencies ───────────────────────────────────────────────────────

const mockFindByWorkspace = jest.fn()
const mockFindWithPermission = jest.fn()
const mockFindById = jest.fn()
const mockGetMaxSortOrder = jest.fn()
const mockCreate = jest.fn()
const mockDeleteWithDescendants = jest.fn()
const mockUpsertEditor = jest.fn()

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
    findAncestors: jest.fn().mockResolvedValue([]),
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
