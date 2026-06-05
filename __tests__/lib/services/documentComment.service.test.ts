// __tests__/lib/services/documentComment.service.test.ts
import { documentCommentService } from '@/lib/services/documentComment.service'
import { documentCommentRepository } from '@/lib/repositories/documentComment.repository'
import { documentRepository } from '@/lib/repositories/document.repository'

jest.mock('@/lib/repositories/documentComment.repository')
jest.mock('@/lib/repositories/document.repository')
jest.mock('@/lib/integrations/pusher/server', () => ({
  pushDocumentEvent: jest.fn().mockResolvedValue(undefined),
}))

const repo = documentCommentRepository as jest.Mocked<
  typeof documentCommentRepository
>
const docRepo = documentRepository as jest.Mocked<typeof documentRepository>

const noop = (_p: Promise<unknown>) => {}

const DOC = {
  id: 'd1',
  content: '<p>Hello brave world</p>',
  createdById: 'm-owner',
  shares: [{ memberId: 'm-viewer', role: 'VIEWER' }],
}

beforeEach(() => {
  jest.clearAllMocks()
  docRepo.findWithPermission.mockResolvedValue(DOC as never)
  docRepo.update.mockResolvedValue({} as never)
  repo.create.mockResolvedValue({ id: 'c1' } as never)
})

describe('createCommentWithSideEffects (top-level)', () => {
  it('VIEWER can comment: persists content patch + creates row', async () => {
    await documentCommentService.createCommentWithSideEffects({
      documentId: 'd1',
      memberId: 'm-viewer',
      workspaceId: 'w1',
      authorActorId: 'a-viewer',
      input: {
        id: 'c1',
        body: 'nice',
        from: 7,
        to: 12,
        quotedText: 'brave',
        content: '<p>Hello <span data-comment-id="c1">brave</span> world</p>',
      },
      waitUntil: noop,
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'c1',
        documentId: 'd1',
        quotedText: 'brave',
      })
    )
    expect(docRepo.update).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({
        content: '<p>Hello <span data-comment-id="c1">brave</span> world</p>',
      })
    )
  })

  it('rejects tampered content (text changed) with 400, no writes', async () => {
    await expect(
      documentCommentService.createCommentWithSideEffects({
        documentId: 'd1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        authorActorId: 'a-viewer',
        input: {
          id: 'c1',
          body: 'x',
          from: 7,
          to: 12,
          quotedText: 'brave',
          content: '<p>Hello <span data-comment-id="c1">EVIL</span></p>',
        },
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.create).not.toHaveBeenCalled()
    expect(docRepo.update).not.toHaveBeenCalled()
  })

  it('rejects content that also removes an existing comment mark', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      ...DOC,
      content: '<p>Hello <span data-comment-id="old">brave</span> world</p>',
    } as never)
    await expect(
      documentCommentService.createCommentWithSideEffects({
        documentId: 'd1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        authorActorId: 'a-viewer',
        input: {
          id: 'c1',
          body: 'x',
          from: 1,
          to: 5,
          quotedText: 'Hello',
          // adds c1 but drops the pre-existing "old" mark
          content: '<p><span data-comment-id="c1">Hello</span> brave world</p>',
        },
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.create).not.toHaveBeenCalled()
    expect(docRepo.update).not.toHaveBeenCalled()
  })

  it('rejects content missing the new comment mark', async () => {
    await expect(
      documentCommentService.createCommentWithSideEffects({
        documentId: 'd1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        authorActorId: 'a-viewer',
        input: {
          id: 'c1',
          body: 'x',
          from: 7,
          to: 12,
          quotedText: 'brave',
          content: '<p>Hello brave world</p>', // no comment span at all
        },
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('succeeds (idempotent) when autosave already wrote the new mark into stored content', async () => {
    // Simulate the autosave-won race: stored doc already contains the new
    // comment span for "c1". The client sends the same content. The guard
    // must not 400; it should create the DB row normally.
    const contentWithMark =
      '<p>Hello <span data-comment-id="c1">brave</span> world</p>'
    docRepo.findWithPermission.mockResolvedValue({
      ...DOC,
      content: contentWithMark,
    } as never)
    await documentCommentService.createCommentWithSideEffects({
      documentId: 'd1',
      memberId: 'm-viewer',
      workspaceId: 'w1',
      authorActorId: 'a-viewer',
      input: {
        id: 'c1',
        body: 'nice',
        from: 7,
        to: 12,
        quotedText: 'brave',
        content: contentWithMark, // same as stored — target id already present
      },
      waitUntil: noop,
    })
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', documentId: 'd1' })
    )
  })

  it('denies a member with no access (404)', async () => {
    docRepo.findWithPermission.mockResolvedValue(null as never)
    await expect(
      documentCommentService.createCommentWithSideEffects({
        documentId: 'd1',
        memberId: 'm-stranger',
        workspaceId: 'w1',
        authorActorId: 'a-x',
        input: {
          id: 'c1',
          body: 'x',
          from: 1,
          to: 2,
          quotedText: 'H',
          content: '<p><span data-comment-id="c1">H</span>ello brave world</p>',
        },
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('createCommentWithSideEffects (reply)', () => {
  it('does not patch content for a reply', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
      deletedAt: null,
    } as never)
    repo.create.mockResolvedValue({ id: 'c2' } as never)
    await documentCommentService.createCommentWithSideEffects({
      documentId: 'd1',
      memberId: 'm-viewer',
      workspaceId: 'w1',
      authorActorId: 'a-viewer',
      input: { id: 'c2', body: 'reply', parentId: 'c1' },
      waitUntil: noop,
    })
    expect(docRepo.update).not.toHaveBeenCalled()
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c2', parentId: 'c1' })
    )
  })

  it('rejects a reply whose parent is in another document (400)', async () => {
    repo.findById.mockResolvedValue({
      id: 'cX',
      documentId: 'OTHER_DOC',
      parentId: null,
      deletedAt: null,
    } as never)
    await expect(
      documentCommentService.createCommentWithSideEffects({
        documentId: 'd1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        authorActorId: 'a-viewer',
        input: { id: 'c2', body: 'reply', parentId: 'cX' },
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 400 })
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('rejects a reply to a reply (400)', async () => {
    repo.findById.mockResolvedValue({
      id: 'cR',
      documentId: 'd1',
      parentId: 'c1',
      deletedAt: null,
    } as never)
    await expect(
      documentCommentService.createCommentWithSideEffects({
        documentId: 'd1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        authorActorId: 'a-viewer',
        input: { id: 'c2', body: 'reply', parentId: 'cR' },
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects a reply to a missing/deleted parent (404)', async () => {
    repo.findById.mockResolvedValue(null as never)
    await expect(
      documentCommentService.createCommentWithSideEffects({
        documentId: 'd1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        authorActorId: 'a-viewer',
        input: { id: 'c2', body: 'reply', parentId: 'cZ' },
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('deleteCommentWithSideEffects', () => {
  it('strips the comment span from content on top-level delete', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
    } as never)
    docRepo.findWithPermission.mockResolvedValue({
      ...DOC,
      content: '<p>Hello <span data-comment-id="c1">brave</span> world</p>',
    } as never)
    repo.softDelete.mockResolvedValue({} as never)

    await documentCommentService.deleteCommentWithSideEffects({
      commentId: 'c1',
      memberId: 'm-viewer',
      workspaceId: 'w1',
      waitUntil: noop,
    })
    expect(docRepo.update).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ content: '<p>Hello brave world</p>' })
    )
    expect(repo.softDelete).toHaveBeenCalledWith('c1')
  })
})

describe('detectAndFlagOrphans', () => {
  it('marks DB comments whose ids are absent from content', async () => {
    repo.findByDocumentId.mockResolvedValue([
      { id: 'c1', status: 'OPEN', isOrphaned: false },
      { id: 'c2', status: 'OPEN', isOrphaned: false },
    ] as never)
    repo.setOrphaned.mockResolvedValue({ count: 1 } as never)

    await documentCommentService.detectAndFlagOrphans(
      'd1',
      '<p><span data-comment-id="c1">x</span></p>'
    )
    expect(repo.setOrphaned).toHaveBeenCalledWith(['c2'], true)
  })
})

describe('getComments triggers orphan detection', () => {
  it('flags comments whose id is absent from current doc content', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      ...DOC,
      content: '<p>Hello brave world</p>', // no comment span
    } as never)
    repo.findByDocumentId.mockResolvedValue([
      { id: 'c1', status: 'OPEN', isOrphaned: false },
    ] as never)
    repo.setOrphaned.mockResolvedValue({ count: 1 } as never)
    await documentCommentService.getComments('d1', 'm-viewer', 'w1')
    expect(repo.setOrphaned).toHaveBeenCalledWith(['c1'], true)
  })

  it('denies without doc access (404) and does not detect', async () => {
    docRepo.findWithPermission.mockResolvedValue(null as never)
    await expect(
      documentCommentService.getComments('d1', 'm-x', 'w1')
    ).rejects.toMatchObject({ status: 404 })
    expect(repo.setOrphaned).not.toHaveBeenCalled()
  })
})
