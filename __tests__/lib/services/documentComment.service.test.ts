// __tests__/lib/services/documentComment.service.test.ts
import { documentCommentService } from '@/lib/services/documentComment.service'
import { documentCommentRepository } from '@/lib/repositories/documentComment.repository'
import { documentRepository } from '@/lib/repositories/document.repository'
import { memberRepository, notificationRepository } from '@/lib/repositories'
import { workspaceRepository } from '@/lib/repositories/workspace.repository'

jest.mock('@/lib/repositories/documentComment.repository')
jest.mock('@/lib/repositories/document.repository')
jest.mock('@/lib/integrations/pusher/server', () => ({
  pushDocumentEvent: jest.fn().mockResolvedValue(undefined),
}))
// notifyMentionDelta pushes a realtime inbox event to inApp-enabled recipients.
jest.mock('@/lib/integrations/pusher', () => ({
  pushUserEvent: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/repositories', () => ({
  memberRepository: {
    findByWorkspaceAndClerkIds: jest.fn().mockResolvedValue([]),
  },
  notificationRepository: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findNameAndSlug: jest.fn().mockResolvedValue({ slug: 'acme' }),
  },
}))
jest.mock('@/lib/services/notification.service', () => ({
  shouldNotifyBatch: jest.fn().mockResolvedValue(new Set()),
}))
jest.mock('@/lib/integrations/slack', () => ({
  sendDMNotification: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/actor', () => ({
  getActorClerkId: jest.fn().mockResolvedValue(null),
}))

import { shouldNotifyBatch } from '@/lib/services/notification.service'
import { sendDMNotification } from '@/lib/integrations/slack'
import { getActorClerkId } from '@/lib/actor'

const repo = documentCommentRepository as jest.Mocked<
  typeof documentCommentRepository
>
const docRepo = documentRepository as jest.Mocked<typeof documentRepository>
const memberRepoMock = memberRepository as jest.Mocked<typeof memberRepository>
const notificationRepoMock = notificationRepository as jest.Mocked<
  typeof notificationRepository
>
const workspaceRepoMock = workspaceRepository as jest.Mocked<
  typeof workspaceRepository
>
const shouldNotifyBatchMock = shouldNotifyBatch as jest.Mock
const sendDMMock = sendDMNotification as jest.Mock
const getActorClerkIdMock = getActorClerkId as jest.Mock

const noop = (_p: Promise<unknown>) => {}

const DOC = {
  id: 'd1',
  content: '<p>Hello brave world</p>',
  createdById: 'm-owner',
  shares: [{ memberId: 'm-viewer', role: 'VIEWER' }],
  title: 'Spec',
  slug: 'spec-3',
}

beforeEach(() => {
  jest.clearAllMocks()
  docRepo.findWithPermission.mockResolvedValue(DOC as never)
  docRepo.update.mockResolvedValue({} as never)
  repo.create.mockResolvedValue({ id: 'c1' } as never)
  // Default: notify deps no-op so existing create tests are unaffected
  workspaceRepoMock.findNameAndSlug.mockResolvedValue({
    name: 'Acme',
    slug: 'acme',
  })
  memberRepoMock.findByWorkspaceAndClerkIds.mockResolvedValue([])
  shouldNotifyBatchMock.mockResolvedValue(new Set())
  getActorClerkIdMock.mockResolvedValue(null)
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
      'w1',
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
      authorActorId: 'a-viewer',
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
      actorId: 'a-viewer',
      waitUntil: noop,
    })
    expect(docRepo.update).toHaveBeenCalledWith(
      'd1',
      'w1',
      expect.objectContaining({ content: '<p>Hello brave world</p>' })
    )
    expect(repo.softDelete).toHaveBeenCalledWith('c1')
  })
})

describe('author-only edit/delete', () => {
  it('rejects edit by a non-author (403)', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
      authorActorId: 'a-owner',
    } as never)
    docRepo.findWithPermission.mockResolvedValue(DOC as never)
    await expect(
      documentCommentService.updateCommentWithSideEffects({
        commentId: 'c1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        actorId: 'a-other',
        body: 'x',
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.update).not.toHaveBeenCalled()
  })
  it('allows edit by the author', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
      authorActorId: 'a-me',
    } as never)
    docRepo.findWithPermission.mockResolvedValue(DOC as never)
    repo.update.mockResolvedValue({ id: 'c1' } as never)
    await documentCommentService.updateCommentWithSideEffects({
      commentId: 'c1',
      memberId: 'm-me',
      workspaceId: 'w1',
      actorId: 'a-me',
      body: 'x',
      waitUntil: noop,
    })
    expect(repo.update).toHaveBeenCalledWith('c1', { body: 'x' })
  })
  it('rejects edit on a null-author comment (403)', async () => {
    // A comment whose authorActorId is null must not be editable by anyone —
    // the old `authorActorId && ...` guard short-circuited and let everyone in.
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
      authorActorId: null,
    } as never)
    docRepo.findWithPermission.mockResolvedValue(DOC as never)
    await expect(
      documentCommentService.updateCommentWithSideEffects({
        commentId: 'c1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        actorId: 'a-anyone',
        body: 'x',
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.update).not.toHaveBeenCalled()
  })
  it('rejects delete by a non-author (403)', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
      authorActorId: 'a-owner',
    } as never)
    docRepo.findWithPermission.mockResolvedValue(DOC as never)
    await expect(
      documentCommentService.deleteCommentWithSideEffects({
        commentId: 'c1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        actorId: 'a-other',
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.softDelete).not.toHaveBeenCalled()
  })
  it('rejects delete on a null-author comment (403)', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
      authorActorId: null,
    } as never)
    docRepo.findWithPermission.mockResolvedValue(DOC as never)
    await expect(
      documentCommentService.deleteCommentWithSideEffects({
        commentId: 'c1',
        memberId: 'm-viewer',
        workspaceId: 'w1',
        actorId: 'a-anyone',
        waitUntil: noop,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(repo.softDelete).not.toHaveBeenCalled()
  })
  it('allows delete by the author', async () => {
    repo.findById.mockResolvedValue({
      id: 'c1',
      documentId: 'd1',
      parentId: null,
      authorActorId: 'a-me',
    } as never)
    docRepo.findWithPermission.mockResolvedValue({
      ...DOC,
      content: '<p>x</p>',
    } as never)
    repo.softDelete.mockResolvedValue({} as never)
    await documentCommentService.deleteCommentWithSideEffects({
      commentId: 'c1',
      memberId: 'm-me',
      workspaceId: 'w1',
      actorId: 'a-me',
      waitUntil: noop,
    })
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

describe('notifyDocMentions', () => {
  it('creates DOCUMENT_COMMENT_MENTIONED inbox notifications for mentioned non-authors', async () => {
    getActorClerkIdMock.mockResolvedValue('author-clerk')
    memberRepoMock.findByWorkspaceAndClerkIds.mockResolvedValue([
      { clerkId: 'bob-clerk', actor: { id: 'a-bob' } },
    ] as never)
    shouldNotifyBatchMock.mockResolvedValue(new Set(['a-bob']))
    notificationRepoMock.createMany.mockResolvedValue({ count: 1 } as never)

    await documentCommentService.notifyDocMentions({
      documentId: 'd1',
      documentCommentId: 'c1',
      body: '<span class="mention" data-id="bob-clerk" data-mention-type="user">@Bob</span> hi',
      authorActorId: 'a-me',
      workspaceId: 'w1',
      docTitle: 'Spec',
      workspaceSlug: 'acme',
      docSlug: 'spec-3',
      waitUntil: noop,
    })

    expect(notificationRepoMock.createMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'DOCUMENT_COMMENT_MENTIONED',
          recipientActorId: 'a-bob',
          documentId: 'd1',
          documentCommentId: 'c1',
          triggerActorId: 'a-me',
          workspaceId: 'w1',
        }),
      ])
    )
  })

  it('sends Slack DM to users with slack mention enabled', async () => {
    getActorClerkIdMock.mockResolvedValue('author-clerk')
    memberRepoMock.findByWorkspaceAndClerkIds.mockResolvedValue([
      { clerkId: 'bob-clerk', actor: { id: 'a-bob' } },
    ] as never)
    shouldNotifyBatchMock.mockResolvedValue(new Set(['a-bob']))
    notificationRepoMock.createMany.mockResolvedValue({ count: 1 } as never)

    await documentCommentService.notifyDocMentions({
      documentId: 'd1',
      documentCommentId: 'c1',
      body: '<span class="mention" data-id="bob-clerk" data-mention-type="user">@Bob</span> hi',
      authorActorId: 'a-me',
      workspaceId: 'w1',
      docTitle: 'Spec',
      workspaceSlug: 'acme',
      docSlug: 'spec-3',
      waitUntil: noop,
    })

    expect(sendDMMock).toHaveBeenCalledWith(
      'w1',
      'bob-clerk',
      'comment_mention',
      expect.objectContaining({
        taskTitle: 'Spec',
        taskUrl: expect.stringContaining('/workspace/acme/documents/spec-3'),
      })
    )
  })

  it('does NOT notify for task mentions (data-mention-type="task")', async () => {
    getActorClerkIdMock.mockResolvedValue('author-clerk')

    await documentCommentService.notifyDocMentions({
      documentId: 'd1',
      documentCommentId: 'c1',
      body: '<span class="mention" data-id="task-abc" data-mention-type="task">@TaskTitle</span> hi',
      authorActorId: 'a-me',
      workspaceId: 'w1',
      docTitle: 'Spec',
      workspaceSlug: 'acme',
      docSlug: 'spec-3',
      waitUntil: noop,
    })

    expect(memberRepoMock.findByWorkspaceAndClerkIds).not.toHaveBeenCalled()
    expect(notificationRepoMock.createMany).not.toHaveBeenCalled()
  })

  it('no-ops when there are no mentions', async () => {
    await documentCommentService.notifyDocMentions({
      documentId: 'd1',
      documentCommentId: 'c1',
      body: 'plain text',
      authorActorId: 'a-me',
      workspaceId: 'w1',
      docTitle: 'S',
      workspaceSlug: 'a',
      docSlug: 's',
      waitUntil: noop,
    })
    expect(notificationRepoMock.createMany).not.toHaveBeenCalled()
  })

  it('no-ops when no members match the mentioned ids', async () => {
    getActorClerkIdMock.mockResolvedValue('author-clerk')
    memberRepoMock.findByWorkspaceAndClerkIds.mockResolvedValue([])

    await documentCommentService.notifyDocMentions({
      documentId: 'd1',
      documentCommentId: 'c1',
      body: '<span class="mention" data-id="unknown-clerk" data-mention-type="user">@X</span>',
      authorActorId: 'a-me',
      workspaceId: 'w1',
      docTitle: 'S',
      workspaceSlug: 'a',
      docSlug: 's',
      waitUntil: noop,
    })
    expect(notificationRepoMock.createMany).not.toHaveBeenCalled()
  })
})

describe('slug-as-documentId (LUM-237)', () => {
  // The client passes the URL slug as `documentId`. findWithPermission accepts
  // {OR:[{id},{slug}]}, so it resolves the slug to the real doc (id 'd1'). Every
  // downstream repo write/lookup must use the resolved doc.id, NOT the raw slug,
  // or document.update({where:{id:slug}}) throws Prisma P2025 → 500.
  it('create: patches content + creates row by resolved doc.id, not the slug', async () => {
    docRepo.findWithPermission.mockResolvedValue(DOC as never) // DOC.id === 'd1'
    await documentCommentService.createCommentWithSideEffects({
      documentId: 'spec-3', // the slug, not the id
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
    expect(docRepo.update).toHaveBeenCalledWith('d1', 'w1', expect.anything())
    expect(docRepo.update).not.toHaveBeenCalledWith(
      'spec-3',
      expect.anything(),
      expect.anything()
    )
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'd1' })
    )
  })

  it('getComments: detects orphans + lists by resolved doc.id, not the slug', async () => {
    docRepo.findWithPermission.mockResolvedValue({
      ...DOC,
      content: '<p>Hello brave world</p>',
    } as never)
    repo.findByDocumentId.mockResolvedValue([
      { id: 'c1', status: 'OPEN', isOrphaned: false },
    ] as never)
    repo.setOrphaned.mockResolvedValue({ count: 1 } as never)
    await documentCommentService.getComments('spec-3', 'm-viewer', 'w1')
    expect(repo.findByDocumentId).toHaveBeenCalledWith('d1')
    expect(repo.findByDocumentId).not.toHaveBeenCalledWith('spec-3')
  })
})
