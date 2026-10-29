// __tests__/services/comment.service.commentsSummary.test.ts
// LUM-122 Task 6: new comment writes trigger an async comments-summary
// recompute only when the thread has > 3 comments. <= 3 never calls the LLM.
/** @jest-environment node */
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { scheduleOutbound: jest.fn() },
}))
jest.mock('@/lib/repositories/comment.repository')
jest.mock('@/lib/repositories', () => ({
  memberRepository: {
    findByWorkspaceAndClerkIds: jest.fn().mockResolvedValue([]),
  },
  notificationRepository: { createMany: jest.fn() },
  taskRepository: { updateCommentsSummary: jest.fn() },
}))
jest.mock('@/lib/integrations/slack', () => ({
  sendDMNotification: jest.fn(),
  sendChannelNotification: jest.fn(),
}))
jest.mock('@/lib/integrations/pusher', () => ({
  pushTaskEvent: jest.fn(),
  pushUserEvent: jest.fn(),
}))
jest.mock('@/lib/events/dispatcher', () => ({ dispatchEvents: jest.fn() }))

import { commentService } from '@/lib/services/comment.service'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { taskRepository } from '@/lib/repositories'
import { contentSummaryService } from '@/lib/services/content-summary.service'

const repoCreate = commentRepository.create as jest.Mock
const repoListAll = commentRepository.listAllForTask as jest.Mock
const updateSummary = taskRepository.updateCommentsSummary as jest.Mock

const flush = () => new Promise(r => setTimeout(r, 0))

const baseInput = {
  taskId: 't1',
  authorActorId: 'a1',
  body: '<p>hi</p>',
  parentId: null,
  quotedCommentId: null,
  authorClerkId: 'u1',
  workspaceId: 'w1',
  projectId: 'p1',
  taskTitle: 't',
  taskNumber: 1,
  teamIdentifier: 'X',
  workspaceSlug: 's',
  waitUntil: (p: Promise<unknown>) => p,
} as const

beforeEach(() => jest.clearAllMocks())

describe('buildCommentsSummaryInput', () => {
  it('joins author + body lines', () => {
    expect(
      commentService.buildCommentsSummaryInput([
        { authorActorId: 'a1', body: 'first' },
        { authorActorId: 'a2', body: 'second' },
      ])
    ).toBe('a1: first\na2: second')
  })
})

describe('comments summary scheduling on create', () => {
  it('summarizes comments only when count > 3', async () => {
    const spy = jest
      .spyOn(contentSummaryService, 'summarize')
      .mockResolvedValue('sum')
    repoCreate.mockResolvedValue({ id: 'c4' })
    repoListAll.mockResolvedValue([
      { authorActorId: 'a1', body: 'one' },
      { authorActorId: 'a2', body: 'two' },
      { authorActorId: 'a1', body: 'three' },
      { authorActorId: 'a3', body: 'four' },
    ])

    await commentService.createCommentWithSideEffects({ ...baseInput } as any)
    await flush()

    expect(spy).toHaveBeenCalledWith(
      'a1: one\na2: two\na1: three\na3: four',
      'comments',
      { taskId: 't1' }
    )
    expect(updateSummary).toHaveBeenCalledWith('t1', 'sum')
    spy.mockRestore()
  })

  it('does NOT summarize when count <= 3', async () => {
    const spy = jest
      .spyOn(contentSummaryService, 'summarize')
      .mockResolvedValue('sum')
    repoCreate.mockResolvedValue({ id: 'c3' })
    repoListAll.mockResolvedValue([
      { authorActorId: 'a1', body: 'one' },
      { authorActorId: 'a2', body: 'two' },
      { authorActorId: 'a1', body: 'three' },
    ])

    await commentService.createCommentWithSideEffects({ ...baseInput } as any)
    await flush()

    expect(spy).not.toHaveBeenCalled()
    expect(updateSummary).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not write summary when LLM returns blank', async () => {
    const spy = jest
      .spyOn(contentSummaryService, 'summarize')
      .mockResolvedValue('')
    repoCreate.mockResolvedValue({ id: 'c4' })
    repoListAll.mockResolvedValue([
      { authorActorId: 'a1', body: 'one' },
      { authorActorId: 'a2', body: 'two' },
      { authorActorId: 'a1', body: 'three' },
      { authorActorId: 'a3', body: 'four' },
    ])

    await commentService.createCommentWithSideEffects({ ...baseInput } as any)
    await flush()

    expect(spy).toHaveBeenCalled()
    expect(updateSummary).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
