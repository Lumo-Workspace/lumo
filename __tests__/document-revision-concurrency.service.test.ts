/**
 * @jest-environment node
 *
 * LUM-409 — optimistic concurrency on the document body.
 *
 * Three layers pinned here:
 *   1. repository (real implementation via requireActual, prisma mocked):
 *      content-changing updates bump contentRevision; an
 *      expectedContentRevision makes the row update CONDITIONAL
 *      (where: { id, contentRevision }) so a concurrent racer can't be
 *      silently overwritten — no check-then-write window.
 *   2. service: a stale ifRevision is rejected with 409 up front (nothing
 *      persisted, tags untouched) and a repo-level conflict maps to 409.
 *   3. every body-replacing path bumps: markdown upload and HTML-direct web
 *      edit both go through the same repository increment.
 */

// ── Prisma mock (used by the REAL repository under requireActual) ───────────

const mockTxUpdate = jest.fn()
const mockTxUpdateMany = jest.fn()
const mockTxFindUniqueOrThrow = jest.fn()
const mockTxMentionFindMany = jest.fn()

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: jest.fn((fn: any) =>
      fn({
        document: {
          update: (...args: any[]) => mockTxUpdate(...args),
          updateMany: (...args: any[]) => mockTxUpdateMany(...args),
          findUniqueOrThrow: (...args: any[]) =>
            mockTxFindUniqueOrThrow(...args),
        },
        documentMention: {
          findMany: (...args: any[]) => mockTxMentionFindMany(...args),
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      })
    ),
  },
}))

// ── Service-layer dependency mocks ──────────────────────────────────────────

const mockFindWithPermission = jest.fn()
const mockFindById = jest.fn()
const mockUpdateWithChildrenAndMentions = jest.fn()
const mockSyncDocumentTags = jest.fn()

jest.mock('@/lib/repositories/document.repository', () => ({
  documentRepository: {
    findWithPermission: (...args: any[]) => mockFindWithPermission(...args),
    findById: (...args: any[]) => mockFindById(...args),
    updateWithChildrenAndMentions: (...args: any[]) =>
      mockUpdateWithChildrenAndMentions(...args),
    upsertEditor: jest.fn().mockResolvedValue(undefined),
    findNodeWithChildren: jest.fn().mockResolvedValue(null),
  },
}))

jest.mock('@/lib/repositories/tag.repository', () => ({
  tagRepository: {
    findByDocument: jest.fn().mockResolvedValue([]),
    syncDocumentTags: (...args: any[]) => mockSyncDocumentTags(...args),
    addDocumentTags: jest.fn().mockResolvedValue(undefined),
    removeDocumentTags: jest.fn().mockResolvedValue(undefined),
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
    findByWorkspaceIdentifier: jest.fn(),
    findByIdForMention: jest.fn(),
  },
}))

jest.mock('@clerk/nextjs/server', () => ({
  clerkClient: jest.fn().mockResolvedValue({
    users: { getUserList: jest.fn().mockResolvedValue({ data: [] }) },
  }),
}))

import { documentService } from '@/lib/services/document.service'

// Real repository implementation, but its prisma import resolves to the mock
// above — exactly what we need to test the conditional-write SQL shape.
const { documentRepository: realDocumentRepository } = jest.requireActual(
  '@/lib/repositories/document.repository'
) as typeof import('@/lib/repositories/document.repository')

beforeEach(() => {
  jest.clearAllMocks()
  mockSnapshotOnSave.mockResolvedValue(undefined)
  mockTxUpdate.mockResolvedValue({ id: 'doc-1' })
  mockTxFindUniqueOrThrow.mockResolvedValue({ id: 'doc-1' })
  mockTxMentionFindMany.mockResolvedValue([])
  mockFindWithPermission.mockResolvedValue({
    id: 'doc-1',
    number: 7,
    title: 'Doc',
    content: '<p>old</p>',
    sourceMarkdown: '# old',
    contentRevision: 6,
    createdById: 'm-1',
    shares: [],
    parentId: null,
  })
  mockUpdateWithChildrenAndMentions.mockResolvedValue({
    id: 'doc-1',
    title: 'Doc',
    emoji: null,
    slug: 'doc-7',
    contentRevision: 7,
  })
})

// ── Repository layer ────────────────────────────────────────────────────────

describe('repository: conditional write + revision bump', () => {
  it('a content-changing update increments contentRevision', async () => {
    await realDocumentRepository.updateWithChildrenAndMentions(
      'doc-1',
      'ws-1',
      { content: '<p>new</p>', sourceMarkdown: '# new' },
      undefined,
      undefined
    )

    expect(mockTxUpdate).toHaveBeenCalledTimes(1)
    expect(mockTxUpdate.mock.calls[0]![0].data.contentRevision).toEqual({
      increment: 1,
    })
  })

  it('an HTML-direct (web editor) content update bumps exactly the same way', async () => {
    await realDocumentRepository.updateWithChildrenAndMentions(
      'doc-1',
      'ws-1',
      { content: '<p>from web editor</p>', sourceMarkdown: null },
      undefined,
      undefined
    )
    expect(mockTxUpdate.mock.calls[0]![0].data.contentRevision).toEqual({
      increment: 1,
    })
  })

  it('a title-only update does NOT bump the body revision', async () => {
    await realDocumentRepository.updateWithChildrenAndMentions(
      'doc-1',
      'ws-1',
      { title: 'renamed', slug: 'renamed-7' },
      undefined,
      undefined
    )
    expect(mockTxUpdate.mock.calls[0]![0].data.contentRevision).toBeUndefined()
  })

  it('expectedContentRevision makes the write conditional on the revision column', async () => {
    mockTxUpdateMany.mockResolvedValue({ count: 1 })

    await realDocumentRepository.updateWithChildrenAndMentions(
      'doc-1',
      'ws-1',
      { content: '<p>x</p>' },
      undefined,
      undefined,
      { expectedContentRevision: 4 }
    )

    expect(mockTxUpdate).not.toHaveBeenCalled()
    expect(mockTxUpdateMany).toHaveBeenCalledTimes(1)
    expect(mockTxUpdateMany.mock.calls[0]![0].where).toEqual({
      id: 'doc-1',
      workspaceId: 'ws-1',
      contentRevision: 4,
    })
    // The conditional path still bumps the revision in the same write.
    expect(mockTxUpdateMany.mock.calls[0]![0].data.contentRevision).toEqual({
      increment: 1,
    })
  })

  it('a lost race (count 0) throws REVISION_CONFLICT and persists nothing', async () => {
    mockTxUpdateMany.mockResolvedValue({ count: 0 })

    await expect(
      realDocumentRepository.updateWithChildrenAndMentions(
        'doc-1',
        'ws-1',
        { content: '<p>stale</p>' },
        undefined,
        undefined,
        { expectedContentRevision: 3 }
      )
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' })

    expect(mockTxUpdate).not.toHaveBeenCalled()
    expect(mockTxFindUniqueOrThrow).not.toHaveBeenCalled()
  })
})

// ── Service layer ───────────────────────────────────────────────────────────

describe('service: stale ifRevision → 409, nothing persisted', () => {
  it('rejects a stale ifRevision with 409 before any write (tags included)', async () => {
    await expect(
      documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
        contentMarkdown: '# stale base',
        tagIds: ['t1'],
        ifRevision: 5,
      })
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('current revision: 6'),
    })

    expect(mockUpdateWithChildrenAndMentions).not.toHaveBeenCalled()
    expect(mockSyncDocumentTags).not.toHaveBeenCalled()
  })

  it('a matching ifRevision goes through as a conditional write', async () => {
    await documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
      contentMarkdown: '# fresh base',
      ifRevision: 6,
    })

    const options = mockUpdateWithChildrenAndMentions.mock.calls[0]![5]
    expect(options).toEqual({ expectedContentRevision: 6 })
  })

  it('maps a repo-level race conflict to 409 with the fresh revision', async () => {
    mockUpdateWithChildrenAndMentions.mockRejectedValue(
      Object.assign(new Error('contentRevision mismatch'), {
        code: 'REVISION_CONFLICT',
      })
    )
    mockFindById.mockResolvedValue({ id: 'doc-1', contentRevision: 7 })

    await expect(
      documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
        contentMarkdown: '# racing base',
        ifRevision: 6,
      })
    ).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('current revision: 7'),
    })
  })

  it('without ifRevision the update is unconditional (back-compat last-write-wins)', async () => {
    await documentService.updateDocument('doc-1', 'm-1', 'ws-1', {
      contentMarkdown: '# no precondition',
    })
    const options = mockUpdateWithChildrenAndMentions.mock.calls[0]![5]
    expect(options).toBeUndefined()
  })
})
