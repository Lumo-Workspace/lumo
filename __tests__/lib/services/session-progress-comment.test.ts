/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findProgressContextForMember: jest.fn(),
    setLastProgressCommentAt: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: { findMemberIdForHook: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findForComment: jest.fn() },
}))
jest.mock('@/lib/services/comment.service', () => ({
  commentService: { createCommentWithSideEffects: jest.fn() },
}))
jest.mock('@/lib/actor', () => ({ getHumanActorId: jest.fn() }))
jest.mock('@/lib/services/task.service', () => ({ taskService: {} }))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {},
}))

import { sessionService } from '@/lib/services/session.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { commentService } from '@/lib/services/comment.service'
import { getHumanActorId } from '@/lib/actor'

// identity.user.id is the clerkId on VerifyApiKeyResult
const identity = {
  user: { id: 'ck1' },
  workspace: { id: 'w1', slug: 'lumo', name: 'Lumo' },
  apiKey: { id: 'ak1', name: 'test', prefix: 'test' },
} as never
const memberId = miscRepository.findMemberIdForHook as jest.Mock
const ctx = sessionRepository.findProgressContextForMember as jest.Mock
const setWm = sessionRepository.setLastProgressCommentAt as jest.Mock
const findForComment = taskRepository.findForComment as jest.Mock
const createComment = commentService.createCommentWithSideEffects as jest.Mock
const actor = getHumanActorId as jest.Mock
const waitUntil = jest.fn()

beforeEach(() => {
  jest.clearAllMocks()
  memberId.mockResolvedValue('m1')
  actor.mockResolvedValue('actor1')
})

describe('postProgressComment', () => {
  it('throws 409 when the session has no bound task', async () => {
    ctx.mockResolvedValue({
      taskId: null,
      taskIdentifier: null,
      taskTitle: null,
      lastProgressCommentAt: null,
    })
    await expect(
      sessionService.postProgressComment({
        identity,
        sessionId: 's1',
        body: 'x',
        watermark: '2026-06-01T10:00:00.000Z',
        waitUntil,
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(createComment).not.toHaveBeenCalled()
  })

  it('throws 404 when the session is missing/unowned', async () => {
    ctx.mockResolvedValue(null)
    await expect(
      sessionService.postProgressComment({
        identity,
        sessionId: 's1',
        body: 'x',
        watermark: '2026-06-01T10:00:00.000Z',
        waitUntil,
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('creates the comment then advances the watermark', async () => {
    ctx.mockResolvedValue({
      taskId: 't1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'T',
      lastProgressCommentAt: null,
    })
    findForComment.mockResolvedValue({
      projectId: 'p1',
      title: 'T',
      number: 42,
      team: { identifier: 'LUM' },
      project: { workspaceId: 'w1', workspace: { slug: 'lumo' } },
    })
    createComment.mockResolvedValue({ id: 'c1' })
    const r = await sessionService.postProgressComment({
      identity,
      sessionId: 's1',
      body: '本次会话进度\n- A',
      watermark: '2026-06-01T10:00:00.000Z',
      waitUntil,
    })
    expect(r).toEqual({ commentId: 'c1' })
    expect(createComment).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        body: '本次会话进度\n- A',
        authorActorId: 'actor1',
        parentId: null,
        quotedCommentId: null,
        authorClerkId: 'ck1',
        workspaceId: 'w1',
        projectId: 'p1',
        taskTitle: 'T',
        taskNumber: 42,
        teamIdentifier: 'LUM',
        workspaceSlug: 'lumo',
      })
    )
    expect(setWm).toHaveBeenCalledWith('s1', new Date('2026-06-01T10:00:00.000Z'))
    // watermark advances only after a successful comment create
    expect(createComment.mock.invocationCallOrder[0]!).toBeLessThan(
      setWm.mock.invocationCallOrder[0]!
    )
  })
})
