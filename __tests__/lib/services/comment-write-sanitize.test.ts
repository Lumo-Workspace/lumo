/**
 * @jest-environment node
 */
/**
 * LUM-921: comment bodies are member/agent-authored HTML (the API, `lumo task
 * comment`, send-back notes). They are sanitized against the shared rich-html
 * policy before they are stored, so no render path can be the one that forgot.
 */
jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: {
    findById: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/documentComment.repository')
jest.mock('@/lib/repositories/document.repository')
jest.mock('@/lib/db/prisma', () => ({ prisma: {} }))
jest.mock('@/lib/actor', () => ({
  getActorClerkId: jest.fn().mockResolvedValue(null),
}))
jest.mock('@/lib/integrations/pusher/server', () => ({
  pushDocumentEvent: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/repositories/workspace.repository', () => ({
  workspaceRepository: {
    findNameAndSlug: jest.fn().mockResolvedValue({ slug: 'acme' }),
  },
}))
jest.mock('@/lib/services/mention-notify.service', () => ({
  notifyMentionDelta: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: {
    scheduleOutbound: jest.fn().mockResolvedValue(undefined),
  },
}))

import { commentRepository } from '@/lib/repositories/comment.repository'
import { documentCommentRepository } from '@/lib/repositories/documentComment.repository'
import { documentRepository } from '@/lib/repositories/document.repository'
import { commentService } from '@/lib/services/comment.service'
import { documentCommentService } from '@/lib/services/documentComment.service'
import { buildHeader } from '@/lib/integrations/github/markdown-bridge'

const MENTION =
  '<span data-type="mention" data-id="user_123" data-label="Ada" class="mention">@Ada</span>'
const SAFE = `<p>hi ${MENTION} see <a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">link</a> <img src="https://cdn.test/a.png" alt="a"></p>`
const EVIL =
  '<p>x<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">y</a><svg onload=alert(4)></svg></p>'

function assertInert(stored: string) {
  expect(stored).not.toMatch(/\son\w+\s*=/i)
  expect(stored).not.toMatch(/<script|<svg|javascript:/i)
}

const taskRepo = commentRepository as jest.Mocked<typeof commentRepository>
const docCommentRepo = documentCommentRepository as jest.Mocked<
  typeof documentCommentRepository
>
const docRepo = documentRepository as jest.Mocked<typeof documentRepository>
const noop = (_p: Promise<unknown>) => {}

beforeEach(() => {
  jest.clearAllMocks()
  taskRepo.create.mockResolvedValue({ id: 'c1' } as never)
  taskRepo.update.mockResolvedValue({ id: 'c1' } as never)
  docRepo.findWithPermission.mockResolvedValue({
    id: 'd1',
    content: '<p>Hello brave world</p>',
    title: 'Spec',
    slug: 'spec-1',
  } as never)
  docCommentRepo.create.mockResolvedValue({ id: 'dc1' } as never)
  docCommentRepo.update.mockResolvedValue({ id: 'dc1' } as never)
})

describe('comment writes are sanitized against the rich-html policy', () => {
  const taskInput = {
    taskId: 't1',
    authorActorId: 'a1',
    parentId: null,
    quotedCommentId: null,
  }

  it('task comment create strips executable HTML', async () => {
    await commentService.createComment({ ...taskInput, body: EVIL })
    const stored = taskRepo.create.mock.calls[0]![0].body
    assertInert(stored)
    expect(stored).toContain('<p>x<img src="x" />')
  })

  it('task comment create keeps mentions, links and images byte-for-byte', async () => {
    await commentService.createComment({ ...taskInput, body: SAFE })
    const stored = taskRepo.create.mock.calls[0]![0].body
    expect(stored).toContain(MENTION)
    expect(stored).toContain('<a href="https://example.com"')
    expect(stored).toContain('<img src="https://cdn.test/a.png" alt="a" />')
  })

  it('task comment create keeps the pr-mirror header marker', async () => {
    const body = buildHeader('💬 Commented') + '<p>ok</p>'
    await commentService.createComment({ ...taskInput, body })
    expect(taskRepo.create.mock.calls[0]![0].body).toBe(body)
  })

  it('task comment edit strips executable HTML', async () => {
    await commentService.updateCommentWithSideEffects({
      commentId: 'c1',
      body: EVIL,
      waitUntil: noop,
    })
    assertInert(taskRepo.update.mock.calls[0]![1].body as string)
  })

  it('document comment create strips executable HTML', async () => {
    await documentCommentService.createCommentWithSideEffects({
      documentId: 'd1',
      memberId: 'm1',
      workspaceId: 'w1',
      authorActorId: 'a1',
      input: {
        id: 'dc1',
        body: EVIL,
        from: 7,
        to: 12,
        quotedText: 'brave',
        content: '<p>Hello <span data-comment-id="dc1">brave</span> world</p>',
      },
      waitUntil: noop,
    })
    assertInert(docCommentRepo.create.mock.calls[0]![0].body)
  })

  it('document comment edit strips executable HTML', async () => {
    docCommentRepo.findById.mockResolvedValue({
      id: 'dc1',
      documentId: 'd1',
      parentId: null,
      authorActorId: 'a1',
    } as never)
    await documentCommentService.updateCommentWithSideEffects({
      commentId: 'dc1',
      memberId: 'm1',
      workspaceId: 'w1',
      actorId: 'a1',
      body: EVIL,
      waitUntil: noop,
    })
    assertInert(docCommentRepo.update.mock.calls[0]![1].body as string)
  })
})
