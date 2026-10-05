import { documentService } from '@/lib/services/document.service'
import { tagRepository } from '@/lib/repositories/tag.repository'
import { updateDocumentSchema } from '@/lib/validation/schemas'

// ── Mock dependencies ───────────────────────────────────────────────────────

const mockFindByWorkspace = jest.fn()
const mockFindWithPermission = jest.fn()
const mockFindById = jest.fn()
const mockGetMaxSortOrder = jest.fn()
const mockCreate = jest.fn()
const mockTrashDocument = jest.fn()
const mockUpsertEditor = jest.fn()
const mockFindMention = jest.fn()
const mockAddExplicitMention = jest.fn()
const mockRemoveExplicitMention = jest.fn()
const mockUpdateWithChildrenAndMentions = jest.fn()

const mockFindByWorkspaceIdentifier = jest.fn()
const mockFindByIdForMention = jest.fn()
const mockFindEditable = jest.fn()
const mockFindProjectIdInWorkspace = jest.fn()
// LUM-994: every id is "in the workspace" unless a case says otherwise.
const echoIds = async (ids: string[]) => ids.map(id => ({ id }))
const mockFindDocIdsInWorkspace = jest.fn(echoIds)
const mockFindTagIdsInWorkspace = jest.fn(echoIds)

jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findByWorkspace: (...args: any[]) => mockFindByWorkspace(...args),
    findWithPermission: (...args: any[]) => mockFindWithPermission(...args),
    findById: (...args: any[]) => mockFindById(...args),
    getMaxSortOrder: (...args: any[]) => mockGetMaxSortOrder(...args),
    create: (...args: any[]) => mockCreate(...args),
    upsertEditor: (...args: any[]) => mockUpsertEditor(...args),
    findNodeWithChildren: jest.fn().mockResolvedValue(null),
    findEditable: (...args: any[]) => mockFindEditable(...args),
    findIdsInWorkspace: (...args: any[]) =>
      (mockFindDocIdsInWorkspace as jest.Mock)(...args),
    findMention: (...args: any[]) => mockFindMention(...args),
    addExplicitMention: (...args: any[]) => mockAddExplicitMention(...args),
    removeExplicitMention: (...args: any[]) =>
      mockRemoveExplicitMention(...args),
    updateWithChildrenAndMentions: (...args: any[]) =>
      mockUpdateWithChildrenAndMentions(...args),
  },
}))

jest.mock('@/lib/repositories/project.repository', () => ({
  projectRepository: {
    findIdInWorkspace: (...args: any[]) =>
      mockFindProjectIdInWorkspace(...args),
  },
}))

const mockRecordAudit = jest.fn()
jest.mock('@/lib/services/audit.service', () => ({
  recordAuditEvent: (...a: any[]) => mockRecordAudit(...a),
}))

jest.mock('@/lib/services/trash.service', () => ({
  trashService: {
    trashDocument: (...args: any[]) => mockTrashDocument(...args),
  },
}))

jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByDocument: jest.fn().mockResolvedValue([]),
    syncDocumentTags: jest.fn().mockResolvedValue(undefined),
    addDocumentTags: jest.fn().mockResolvedValue(undefined),
    removeDocumentTags: jest.fn().mockResolvedValue(undefined),
    findIdsInWorkspace: (...args: any[]) =>
      (mockFindTagIdsInWorkspace as jest.Mock)(...args),
  },
}))

const mockSnapshotOnSave = jest.fn()
jest.mock('@/lib/services/documentRevision.service', () => ({
  documentRevisionService: {
    snapshotOnSave: (...a: any[]) => mockSnapshotOnSave(...a),
  },
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    findByWorkspaceIdentifier: (...args: any[]) =>
      mockFindByWorkspaceIdentifier(...args),
    findByIdForMention: (...args: any[]) => mockFindByIdForMention(...args),
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

beforeEach(() => {
  jest.clearAllMocks()
  // snapshotOnSave is awaited inside waitUntil(...).catch(); it must return a
  // promise. clearAllMocks() resets the implementation each test, so re-arm it.
  mockSnapshotOnSave.mockResolvedValue(undefined)
})

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

    it('regenerates slug when title changes, keeping number stable', async () => {
      mockFindWithPermission.mockResolvedValue({
        id: 'doc-1',
        createdById: 'm-1',
        shares: [],
        number: 12,
        slug: 'old-title-12',
      })
      mockUpdateWithChildrenAndMentions.mockResolvedValue({
        id: 'doc-1',
        title: 'Fresh Name',
        slug: 'fresh-name-12',
      })

      await documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
        title: 'Fresh Name',
      })

      expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledWith(
        'doc-1',
        'ws-1',
        expect.objectContaining({ title: 'Fresh Name', slug: 'fresh-name-12' }),
        undefined,
        undefined,
        undefined // no ifRevision → unconditional write (LUM-409)
      )
    })
  })

  describe('updateDocument audit (LUM-907)', () => {
    const ctx = {
      actor: { type: 'MEMBER' as const, memberId: 'm-1' },
      source: 'WEB' as const,
    }
    const owned = (over: Record<string, unknown> = {}) => ({
      id: 'doc-1',
      createdById: 'm-1',
      shares: [],
      number: 3,
      visibility: 'PRIVATE',
      publicToken: null,
      ...over,
    })
    beforeEach(() => {
      mockUpdateWithChildrenAndMentions.mockResolvedValue({
        id: 'doc-1',
        title: 'T',
        slug: 't-3',
      })
    })

    it('document audit: a visibility change records from and to', async () => {
      mockFindWithPermission.mockResolvedValue(owned())
      await documentService.updateDocument(
        'doc-1',
        'm-1',
        'ws-1',
        { visibility: 'WORKSPACE' },
        { audit: ctx }
      )
      expect(mockRecordAudit).toHaveBeenCalledTimes(1)
      expect(mockRecordAudit).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        action: 'document.visibility_changed',
        target: { type: 'document', id: 'doc-1' },
        metadata: { from: 'PRIVATE', to: 'WORKSPACE' },
        context: ctx,
      })
    })

    it('document audit: enabling, rotating and disabling the public link never record the token', async () => {
      mockFindWithPermission.mockResolvedValue(owned())
      await documentService.updateDocument(
        'doc-1',
        'm-1',
        'ws-1',
        { publicToken: 'tok-secret-1' },
        { audit: ctx }
      )
      mockFindWithPermission.mockResolvedValue(
        owned({ publicToken: 'tok-secret-1' })
      )
      await documentService.updateDocument(
        'doc-1',
        'm-1',
        'ws-1',
        { publicToken: 'tok-secret-2' },
        { audit: ctx }
      )
      await documentService.updateDocument(
        'doc-1',
        'm-1',
        'ws-1',
        { publicToken: null },
        { audit: ctx }
      )
      expect(
        mockRecordAudit.mock.calls.map(c => [c[0].action, c[0].metadata])
      ).toEqual([
        ['document.public_link_enabled', { rotated: false }],
        ['document.public_link_enabled', { rotated: true }],
        ['document.public_link_disabled', { rotated: false }],
      ])
      expect(JSON.stringify(mockRecordAudit.mock.calls)).not.toContain(
        'tok-secret'
      )
    })

    it('document audit: an unchanged visibility or a content-only edit records nothing', async () => {
      mockFindWithPermission.mockResolvedValue(
        owned({ visibility: 'WORKSPACE' })
      )
      await documentService.updateDocument(
        'doc-1',
        'm-1',
        'ws-1',
        { visibility: 'WORKSPACE', title: 'T' },
        { audit: ctx }
      )
      expect(mockRecordAudit).not.toHaveBeenCalled()
    })

    it('document audit: a refused change (non-owner) records nothing', async () => {
      mockFindWithPermission.mockResolvedValue(
        owned({
          createdById: 'other',
          shares: [{ memberId: 'm-1', role: 'EDITOR' }],
        })
      )
      await expect(
        documentService.updateDocument(
          'doc-1',
          'm-1',
          'ws-1',
          { visibility: 'WORKSPACE' },
          { audit: ctx }
        )
      ).rejects.toMatchObject({ status: 403 })
      expect(mockRecordAudit).not.toHaveBeenCalled()
    })
  })

  describe('updateDocument revision capture', () => {
    it('schedules a snapshot when content changes', async () => {
      mockFindWithPermission.mockResolvedValue({
        id: 'd1',
        number: 1,
        createdById: 'm1',
        shares: [],
      })
      mockUpdateWithChildrenAndMentions.mockResolvedValue({
        id: 'd1',
        title: 'T',
        emoji: null,
        content: '<p>new</p>',
      })
      await documentService.updateDocument('d1', 'm1', 'ws1', {
        content: '<p>new</p>',
      })
      expect(mockSnapshotOnSave).toHaveBeenCalledWith(
        'd1',
        'ws1',
        'm1',
        expect.objectContaining({
          content: '<p>new</p>',
          title: 'T',
          emoji: null,
        }),
        undefined,
        { forceNewRevision: false }
      )
    })

    it('does NOT schedule a snapshot for a title-only change', async () => {
      mockFindWithPermission.mockResolvedValue({
        id: 'd1',
        number: 1,
        createdById: 'm1',
        shares: [],
      })
      mockUpdateWithChildrenAndMentions.mockResolvedValue({
        id: 'd1',
        title: 'T2',
        emoji: null,
        content: null,
      })
      await documentService.updateDocument('d1', 'm1', 'ws1', { title: 'T2' })
      expect(mockSnapshotOnSave).not.toHaveBeenCalled()
    })
  })

  describe('deleteDocument', () => {
    it('throws 404 when document not found', async () => {
      mockFindById.mockResolvedValue(null)

      await expect(
        documentService.deleteDocument('doc-missing', 'm-1', 'ws-1', 'c-1')
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
        documentService.deleteDocument('doc-1', 'm-1', 'ws-1', 'c-1')
      ).rejects.toMatchObject({
        message: 'Only the owner can delete a document',
        status: 403,
      })
    })

    it('moves the document to the trash for its owner (LUM-918)', async () => {
      mockFindById.mockResolvedValue({ id: 'doc-1', createdById: 'm-1' })
      mockTrashDocument.mockResolvedValue(0)

      await documentService.deleteDocument('doc-1', 'm-1', 'ws-1', 'c-1')

      expect(mockTrashDocument).toHaveBeenCalledWith('doc-1', 'c-1')
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
    mockFindByWorkspaceIdentifier.mockResolvedValue({
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
    mockFindByWorkspaceIdentifier.mockResolvedValue({
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

  it('addExplicitMention creates a fresh row when no existing mention is found', async () => {
    mockFindWithPermission.mockResolvedValue(ownerDoc)
    mockFindByWorkspaceIdentifier.mockResolvedValue({
      id: 'task_cuid_1',
      number: 42,
      team: { identifier: 'LUM' },
    })
    mockFindMention.mockResolvedValue(null)
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

    expect(result.alreadyBound).toBe(false)
    expect(result.upgradedFromContent).toBe(false)
    expect(result.source).toBe('EXPLICIT')
    expect(result.taskIdentifier).toBe('LUM-42')
  })

  it('addExplicitMention 404s when task identifier does not resolve', async () => {
    mockFindWithPermission.mockResolvedValue(ownerDoc)
    mockFindByWorkspaceIdentifier.mockResolvedValue(null)

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
    mockFindByWorkspaceIdentifier.mockResolvedValue({
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
    mockFindByWorkspaceIdentifier.mockResolvedValue({
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
    mockFindByWorkspaceIdentifier.mockResolvedValue({
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
  it('createDocument with contentMarkdown stores HTML for the Tiptap editor', async () => {
    // LUM-83: content is stored as the HTML the editor consumes via
    // setContent / getHTML — NOT a JSON-stringified tiptap doc.
    mockGetMaxSortOrder.mockResolvedValue(0)
    mockCreate.mockImplementation((data: any) => {
      return Promise.resolve({
        id: 'doc-new',
        content: data.content ?? null,
        createdBy: { id: 'm-1', clerkId: 'clerk-1' },
      })
    })

    const result = await documentService.createDocument(
      'workspace1',
      'member1',
      {
        title: 't',
        visibility: 'PRIVATE',
        contentMarkdown: '# Hello',
      }
    )

    expect(result.content).toBeTruthy()
    expect(result.content as string).toMatch(/<h1>Hello<\/h1>/)
    expect((result.content as string).startsWith('{')).toBe(false)
  })

  it('updateDocument with contentMarkdown overwrites content as HTML', async () => {
    mockFindWithPermission.mockResolvedValue({
      id: 'doc1',
      createdById: 'member1',
      shares: [],
    })
    mockUpdateWithChildrenAndMentions.mockImplementation(
      (_id: string, _workspaceId: string, updateData: any) => {
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

    expect(result.content as string).toMatch(/<p>just text<\/p>/)
    expect((result.content as string).startsWith('{')).toBe(false)
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

// ── createDocument tagIds tests ─────────────────────────────────────────────

describe('createDocument tagIds', () => {
  it('attaches tags listed in tagIds after create', async () => {
    mockGetMaxSortOrder.mockResolvedValue(0)
    mockCreate.mockResolvedValue({
      id: 'doc-tagged',
      createdBy: { id: 'm-1', clerkId: 'clerk-1' },
    })
    ;(tagRepository.syncDocumentTags as jest.Mock).mockResolvedValue(undefined)
    ;(tagRepository.findByDocument as jest.Mock).mockResolvedValue([
      { id: 'tag-1', name: 'alpha' },
    ])

    await documentService.createDocument('ws-1', 'm-1', {
      title: 'Tagged Doc',
      visibility: 'WORKSPACE',
      tagIds: ['tag-1'],
    })

    expect(tagRepository.syncDocumentTags).toHaveBeenCalledWith('doc-tagged', [
      'tag-1',
    ])
  })

  it('omits tag work when tagIds is undefined', async () => {
    mockGetMaxSortOrder.mockResolvedValue(0)
    mockCreate.mockResolvedValue({
      id: 'doc-no-tags',
      createdBy: { id: 'm-1', clerkId: 'clerk-1' },
    })
    ;(tagRepository.syncDocumentTags as jest.Mock).mockClear()
    ;(tagRepository.findByDocument as jest.Mock).mockClear()

    await documentService.createDocument('ws-1', 'm-1', {
      title: 'No Tags Doc',
      visibility: 'WORKSPACE',
    })

    expect(tagRepository.syncDocumentTags).not.toHaveBeenCalled()
    expect(tagRepository.findByDocument).not.toHaveBeenCalled()
  })

  it('omits tag work when tagIds is an empty array', async () => {
    mockGetMaxSortOrder.mockResolvedValue(0)
    mockCreate.mockResolvedValue({
      id: 'doc-empty-tags',
      createdBy: { id: 'm-1', clerkId: 'clerk-1' },
    })
    ;(tagRepository.syncDocumentTags as jest.Mock).mockClear()
    ;(tagRepository.findByDocument as jest.Mock).mockClear()

    await documentService.createDocument('ws-1', 'm-1', {
      title: 'Empty Tags Doc',
      visibility: 'WORKSPACE',
      tagIds: [],
    })

    expect(tagRepository.syncDocumentTags).not.toHaveBeenCalled()
    expect(tagRepository.findByDocument).not.toHaveBeenCalled()
  })
})

// ── updateDocument tag branching tests ──────────────────────────────────────

describe('updateDocument tag branching', () => {
  const ownerDocForTags = {
    id: 'doc-tags',
    createdById: 'member1',
    shares: [],
  }

  beforeEach(() => {
    mockFindWithPermission.mockResolvedValue(ownerDocForTags)
    mockUpdateWithChildrenAndMentions.mockResolvedValue({
      id: 'doc-tags',
      title: 'Doc',
    })
    ;(tagRepository.findByDocument as jest.Mock).mockResolvedValue([])
    ;(tagRepository.syncDocumentTags as jest.Mock).mockResolvedValue(undefined)
    ;(tagRepository.addDocumentTags as jest.Mock).mockResolvedValue(undefined)
    ;(tagRepository.removeDocumentTags as jest.Mock).mockResolvedValue(
      undefined
    )
  })

  it('bulk replace via tagIds calls syncDocumentTags', async () => {
    await documentService.updateDocument('doc-tags', 'member1', 'ws-1', {
      tagIds: ['tag-b'],
    })

    expect(tagRepository.syncDocumentTags).toHaveBeenCalledWith('doc-tags', [
      'tag-b',
    ])
    expect(tagRepository.addDocumentTags).not.toHaveBeenCalled()
    expect(tagRepository.removeDocumentTags).not.toHaveBeenCalled()
  })

  it('incremental via addTagIds + removeTagIds applies add then remove', async () => {
    await documentService.updateDocument('doc-tags', 'member1', 'ws-1', {
      addTagIds: ['tag-c'],
      removeTagIds: ['tag-a'],
    })

    expect(tagRepository.syncDocumentTags).not.toHaveBeenCalled()
    expect(tagRepository.addDocumentTags).toHaveBeenCalledWith('doc-tags', [
      'tag-c',
    ])
    expect(tagRepository.removeDocumentTags).toHaveBeenCalledWith('doc-tags', [
      'tag-a',
    ])
  })

  it('does not call any tag repo function when no tag fields provided', async () => {
    await documentService.updateDocument('doc-tags', 'member1', 'ws-1', {
      title: 'New Title',
    })

    expect(tagRepository.syncDocumentTags).not.toHaveBeenCalled()
    expect(tagRepository.addDocumentTags).not.toHaveBeenCalled()
    expect(tagRepository.removeDocumentTags).not.toHaveBeenCalled()
    expect(tagRepository.findByDocument).not.toHaveBeenCalled()
  })

  it('only calls addDocumentTags when only addTagIds provided', async () => {
    await documentService.updateDocument('doc-tags', 'member1', 'ws-1', {
      addTagIds: ['tag-c'],
    })

    expect(tagRepository.addDocumentTags).toHaveBeenCalledWith('doc-tags', [
      'tag-c',
    ])
    expect(tagRepository.removeDocumentTags).not.toHaveBeenCalled()
    expect(tagRepository.syncDocumentTags).not.toHaveBeenCalled()
  })

  it('only calls removeDocumentTags when only removeTagIds provided', async () => {
    await documentService.updateDocument('doc-tags', 'member1', 'ws-1', {
      removeTagIds: ['tag-a'],
    })

    expect(tagRepository.removeDocumentTags).toHaveBeenCalledWith('doc-tags', [
      'tag-a',
    ])
    expect(tagRepository.addDocumentTags).not.toHaveBeenCalled()
    expect(tagRepository.syncDocumentTags).not.toHaveBeenCalled()
  })
})

// ── updateDocumentSchema mutex test ─────────────────────────────────────────
// The mutex is enforced at the schema layer (API route calls safeParse).
// The service itself does not duplicate the check, so we verify here at the
// schema level — not via documentService.updateDocument().

describe('updateDocumentSchema — tagIds mutex', () => {
  it('rejects tagIds + addTagIds at the schema layer', () => {
    const result = updateDocumentSchema.safeParse({
      tagIds: [],
      addTagIds: ['clid0000000000000000000001'],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/mutually exclusive/i)
    }
  })

  it('rejects tagIds + removeTagIds at the schema layer', () => {
    const result = updateDocumentSchema.safeParse({
      tagIds: ['clid0000000000000000000001'],
      removeTagIds: ['clid0000000000000000000002'],
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/mutually exclusive/i)
    }
  })

  it('accepts tagIds alone (no incremental fields)', () => {
    const result = updateDocumentSchema.safeParse({
      tagIds: ['clid0000000000000000000001'],
    })
    expect(result.success).toBe(true)
  })

  it('accepts addTagIds + removeTagIds without tagIds', () => {
    const result = updateDocumentSchema.safeParse({
      addTagIds: ['clid0000000000000000000001'],
      removeTagIds: ['clid0000000000000000000002'],
    })
    expect(result.success).toBe(true)
  })
})

// ── LUM-993: createDocument validates parentId / projectId ──────────────────

describe('createDocument — parent and project must be the caller’s (LUM-993)', () => {
  beforeEach(() => {
    mockFindEditable.mockReset()
    mockFindProjectIdInWorkspace.mockReset()
    mockCreate.mockReset()
    mockGetMaxSortOrder.mockReset().mockResolvedValue(0)
    mockCreate.mockResolvedValue({
      id: 'doc-new',
      createdBy: { id: 'm-1', clerkId: 'clerk-1' },
    })
  })

  it('a parent the member cannot edit in their workspace → 404, nothing created', async () => {
    mockFindEditable.mockResolvedValue(null)
    await expect(
      documentService.createDocument('ws-1', 'm-1', {
        title: 'Child',
        visibility: 'WORKSPACE',
        parentId: 'foreign-parent',
      })
    ).rejects.toMatchObject({
      message: 'Not found or no permission',
      status: 404,
    })
    expect(mockFindEditable).toHaveBeenCalledWith(
      'foreign-parent',
      'm-1',
      'ws-1'
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('an editable parent is stored by its resolved id', async () => {
    mockFindEditable.mockResolvedValue({ id: 'parent-cuid' })
    await documentService.createDocument('ws-1', 'm-1', {
      title: 'Child',
      visibility: 'WORKSPACE',
      parentId: 'parent-slug-7',
    })
    expect(mockGetMaxSortOrder).toHaveBeenCalledWith('ws-1', 'parent-cuid')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'parent-cuid', workspaceId: 'ws-1' })
    )
  })

  it('a project outside the workspace → 404, nothing created', async () => {
    mockFindProjectIdInWorkspace.mockResolvedValue(null)
    await expect(
      documentService.createDocument('ws-1', 'm-1', {
        title: 'Doc',
        visibility: 'WORKSPACE',
        projectId: 'foreign-project',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(mockFindProjectIdInWorkspace).toHaveBeenCalledWith(
      'foreign-project',
      'ws-1'
    )
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('a project in the workspace is stored', async () => {
    mockFindProjectIdInWorkspace.mockResolvedValue({ id: 'proj-1' })
    await documentService.createDocument('ws-1', 'm-1', {
      title: 'Doc',
      visibility: 'WORKSPACE',
      projectId: 'proj-1',
    })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-1' })
    )
  })

  it('an editable parent with a foreign project → 404, nothing created', async () => {
    mockFindEditable.mockResolvedValue({ id: 'parent-cuid' })
    mockFindProjectIdInWorkspace.mockResolvedValue(null)
    await expect(
      documentService.createDocument('ws-1', 'm-1', {
        title: 'Child',
        visibility: 'WORKSPACE',
        parentId: 'parent-cuid',
        projectId: 'foreign-project',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('no parent / no project → no lookups (root create)', async () => {
    await documentService.createDocument('ws-1', 'm-1', {
      title: 'Root',
      visibility: 'WORKSPACE',
    })
    expect(mockFindEditable).not.toHaveBeenCalled()
    expect(mockFindProjectIdInWorkspace).not.toHaveBeenCalled()
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: null, projectId: null })
    )
  })
})

// ── LUM-994: updateDocument validates projectId / tags / childOrder ─────────

describe('updateDocument — referenced ids must be in the caller’s workspace (LUM-994)', () => {
  const ownerDoc = { id: 'doc-994', createdById: 'm-1', shares: [] }

  beforeEach(() => {
    mockFindWithPermission.mockReset().mockResolvedValue(ownerDoc)
    mockUpdateWithChildrenAndMentions
      .mockReset()
      .mockResolvedValue({ id: 'doc-994', title: 'Doc' })
    mockFindProjectIdInWorkspace.mockReset()
    mockFindTagIdsInWorkspace.mockReset().mockImplementation(echoIds)
    mockFindDocIdsInWorkspace.mockReset().mockImplementation(echoIds)
    ;(tagRepository.syncDocumentTags as jest.Mock).mockClear()
    ;(tagRepository.addDocumentTags as jest.Mock).mockClear()
    ;(tagRepository.removeDocumentTags as jest.Mock).mockClear()
  })

  const expectNothingWritten = () => {
    expect(tagRepository.syncDocumentTags).not.toHaveBeenCalled()
    expect(tagRepository.addDocumentTags).not.toHaveBeenCalled()
    expect(tagRepository.removeDocumentTags).not.toHaveBeenCalled()
    expect(mockUpdateWithChildrenAndMentions).not.toHaveBeenCalled()
  }

  it('a projectId outside the workspace → 404, nothing written', async () => {
    mockFindProjectIdInWorkspace.mockResolvedValue(null)
    await expect(
      documentService.updateDocument('doc-994', 'm-1', 'ws-1', {
        projectId: 'foreign-project',
        addTagIds: ['tag-own'],
      })
    ).rejects.toMatchObject({ message: 'Project not found', status: 404 })
    expect(mockFindProjectIdInWorkspace).toHaveBeenCalledWith(
      'foreign-project',
      'ws-1'
    )
    expectNothingWritten()
  })

  it('a projectId in the workspace is written; null clears without a lookup', async () => {
    mockFindProjectIdInWorkspace.mockResolvedValue({ id: 'proj-1' })
    await documentService.updateDocument('doc-994', 'm-1', 'ws-1', {
      projectId: 'proj-1',
    })
    expect(mockUpdateWithChildrenAndMentions).toHaveBeenLastCalledWith(
      'doc-994',
      'ws-1',
      expect.objectContaining({ projectId: 'proj-1' }),
      undefined,
      undefined,
      undefined
    )

    mockFindProjectIdInWorkspace.mockClear()
    await documentService.updateDocument('doc-994', 'm-1', 'ws-1', {
      projectId: null,
    })
    expect(mockFindProjectIdInWorkspace).not.toHaveBeenCalled()
    expect(mockUpdateWithChildrenAndMentions).toHaveBeenLastCalledWith(
      'doc-994',
      'ws-1',
      expect.objectContaining({ projectId: null }),
      undefined,
      undefined,
      undefined
    )
  })

  it.each([
    ['tagIds', { tagIds: ['tag-own', 'tag-foreign'] }],
    ['addTagIds', { addTagIds: ['tag-own', 'tag-foreign'] }],
  ])('%s with a foreign tag → 404, nothing written', async (_label, input) => {
    mockFindTagIdsInWorkspace.mockResolvedValue([{ id: 'tag-own' }])
    await expect(
      documentService.updateDocument('doc-994', 'm-1', 'ws-1', input)
    ).rejects.toMatchObject({ message: 'Tag not found', status: 404 })
    expect(mockFindTagIdsInWorkspace).toHaveBeenCalledWith(
      ['tag-own', 'tag-foreign'],
      'ws-1'
    )
    expectNothingWritten()
  })

  it('duplicate tag ids are checked once and do not read as missing', async () => {
    await documentService.updateDocument('doc-994', 'm-1', 'ws-1', {
      addTagIds: ['tag-a', 'tag-a'],
    })
    expect(mockFindTagIdsInWorkspace).toHaveBeenCalledWith(['tag-a'], 'ws-1')
    expect(tagRepository.addDocumentTags).toHaveBeenCalled()
  })

  it('removeTagIds is not looked up — it only deletes this document’s joins', async () => {
    await documentService.updateDocument('doc-994', 'm-1', 'ws-1', {
      removeTagIds: ['tag-foreign'],
    })
    expect(mockFindTagIdsInWorkspace).not.toHaveBeenCalled()
    expect(tagRepository.removeDocumentTags).toHaveBeenCalledWith('doc-994', [
      'tag-foreign',
    ])
  })

  it('childOrder naming a foreign document → 404 before the tag joins are written', async () => {
    mockFindDocIdsInWorkspace.mockResolvedValue([{ id: 'child-own' }])
    await expect(
      documentService.updateDocument('doc-994', 'm-1', 'ws-1', {
        addTagIds: ['tag-own'],
        childOrder: ['child-own', 'doc-foreign'],
      })
    ).rejects.toMatchObject({ message: 'Document not found', status: 404 })
    expect(mockFindDocIdsInWorkspace).toHaveBeenCalledWith(
      ['child-own', 'doc-foreign'],
      'ws-1'
    )
    expectNothingWritten()
  })

  it('own childOrder is passed to the reorder write', async () => {
    await documentService.updateDocument('doc-994', 'm-1', 'ws-1', {
      childOrder: ['c2', 'c1'],
    })
    expect(mockUpdateWithChildrenAndMentions).toHaveBeenCalledWith(
      'doc-994',
      'ws-1',
      {},
      ['c2', 'c1'],
      undefined,
      undefined
    )
  })

  it('no referenced ids → no lookups', async () => {
    await documentService.updateDocument('doc-994', 'm-1', 'ws-1', {
      title: 'Renamed',
    })
    expect(mockFindProjectIdInWorkspace).not.toHaveBeenCalled()
    expect(mockFindTagIdsInWorkspace).not.toHaveBeenCalled()
    expect(mockFindDocIdsInWorkspace).not.toHaveBeenCalled()
  })
})
