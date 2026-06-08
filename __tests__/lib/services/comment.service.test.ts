// __tests__/lib/services/comment.service.test.ts
/**
 * @jest-environment node
 */

jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: {
    findByTaskId: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
  },
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    task: { findUnique: jest.fn() },
    workspaceMember: { findMany: jest.fn() },
    notification: { createMany: jest.fn() },
  },
}))

jest.mock('@/lib/actor', () => ({
  getHumanActorId: jest.fn(),
}))

jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: {
    scheduleOutbound: jest.fn().mockResolvedValue(undefined),
  },
}))

import { commentRepository } from '@/lib/repositories/comment.repository'
import { commentService } from '@/lib/services/comment.service'

const mockFindByTaskId = commentRepository.findByTaskId as jest.Mock
const mockFindById = commentRepository.findById as jest.Mock
const mockCreate = commentRepository.create as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('commentService.getComments', () => {
  it('returns comments for task', async () => {
    const mockComments = [{ id: 'c1', body: 'Hello', replies: [] }]
    mockFindByTaskId.mockResolvedValue(mockComments)
    const result = await commentService.getComments('task-1')
    expect(result).toEqual(mockComments)
    expect(mockFindByTaskId).toHaveBeenCalledWith('task-1')
  })
})

describe('commentService.createComment', () => {
  it('creates a top-level comment', async () => {
    const mockComment = {
      id: 'c1',
      taskId: 'task-1',
      authorActorId: 'actor-1',
      body: 'Hello',
      parentId: null,
      quotedCommentId: null,
    }
    mockCreate.mockResolvedValue(mockComment)
    const result = await commentService.createComment({
      taskId: 'task-1',
      authorActorId: 'actor-1',
      body: 'Hello',
      parentId: null,
      quotedCommentId: null,
    })
    expect(result).toEqual(mockComment)
  })

  it('throws 404 when parent comment not found', async () => {
    mockFindById.mockResolvedValue(null)
    await expect(
      commentService.createComment({
        taskId: 'task-1',
        authorActorId: 'actor-1',
        body: 'Reply',
        parentId: 'nonexistent',
        quotedCommentId: null,
      })
    ).rejects.toMatchObject({
      message: 'Parent comment not found',
      status: 404,
    })
  })

  it('throws 404 when parent comment is soft-deleted', async () => {
    mockFindById.mockResolvedValue({
      id: 'c-deleted',
      taskId: 'task-1',
      parentId: null,
      deletedAt: new Date(),
    })
    await expect(
      commentService.createComment({
        taskId: 'task-1',
        authorActorId: 'actor-1',
        body: 'Reply to deleted',
        parentId: 'c-deleted',
        quotedCommentId: null,
      })
    ).rejects.toMatchObject({
      message: 'Parent comment not found',
      status: 404,
    })
  })

  it('throws 400 when replying to a reply', async () => {
    mockFindById.mockResolvedValue({
      id: 'c1',
      taskId: 'task-1',
      parentId: 'c0',
      deletedAt: null,
    })
    await expect(
      commentService.createComment({
        taskId: 'task-1',
        authorActorId: 'actor-1',
        body: 'Nested reply',
        parentId: 'c1',
        quotedCommentId: null,
      })
    ).rejects.toMatchObject({ message: 'Cannot reply to a reply', status: 400 })
  })
})

describe('commentService.parseMentionedClerkIds', () => {
  it('extracts unique clerkIds from mention chips', () => {
    const body =
      '<span class="mention" data-id="user-1" data-mention-type="user">@Alice</span> and <span class="mention" data-id="user-2" data-mention-type="user">@Bob</span>'
    const result = commentService.parseMentionedClerkIds(body, 'author-id')
    expect(result).toEqual(['user-1', 'user-2'])
  })

  it('excludes the author clerkId', () => {
    const body =
      '<span class="mention" data-id="author-id" data-mention-type="user">@Me</span>'
    const result = commentService.parseMentionedClerkIds(body, 'author-id')
    expect(result).toEqual([])
  })

  it('excludes __agent__ pseudo-ID', () => {
    const body =
      '<span class="mention" data-id="__agent__" data-mention-type="user">@Agent</span>'
    const result = commentService.parseMentionedClerkIds(body, 'user-1')
    expect(result).toEqual([])
  })

  it('deduplicates clerkIds', () => {
    const body =
      '<span class="mention" data-id="user-1" data-mention-type="user">@A</span> <span class="mention" data-id="user-1" data-mention-type="user">@A</span>'
    const result = commentService.parseMentionedClerkIds(body, 'author')
    expect(result).toEqual(['user-1'])
  })

  it('parses user mentions from real editor HTML (regression for data-type bug)', () => {
    const body =
      '<p>hi <span class="mention" data-id="user_bob" data-mention-type="user">@Bob</span> ' +
      'and <span class="mention mention-task" data-id="task_9" data-mention-type="task">LUM-9 Fix</span></p>'
    expect(commentService.parseMentionedClerkIds(body, 'user_self')).toEqual([
      'user_bob',
    ])
  })
})
