// __tests__/services/comment.service.scheduleOutbound.test.ts
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { scheduleOutbound: jest.fn() },
}))
jest.mock('@/lib/repositories/comment.repository')

import { commentService } from '@/lib/services/comment.service'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentRepository } from '@/lib/repositories/comment.repository'

describe('commentService — mirror hooks', () => {
  beforeEach(() => jest.clearAllMocks())

  it('createCommentWithSideEffects calls scheduleOutbound with op=CREATE and mirrorOrigin=user (default)', async () => {
    ;(commentRepository.create as jest.Mock).mockResolvedValue({ id: 'c1' })
    await commentService.createCommentWithSideEffects({
      taskId: 't1',
      authorActorId: 'a1',
      body: '<p>x</p>',
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
    } as any)
    expect(prCommentMirrorService.scheduleOutbound).toHaveBeenCalledWith(
      'c1',
      'CREATE',
      { mirrorOrigin: 'user' }
    )
  })

  it('does not call scheduleOutbound when mirrorOrigin=inbound', async () => {
    ;(commentRepository.create as jest.Mock).mockResolvedValue({ id: 'c1' })
    await commentService.createCommentWithSideEffects({
      taskId: 't1',
      authorActorId: 'a1',
      body: '<p>x</p>',
      parentId: null,
      quotedCommentId: null,
      authorClerkId: 'u1',
      workspaceId: 'w1',
      projectId: 'p1',
      taskTitle: 't',
      taskNumber: 1,
      teamIdentifier: 'X',
      workspaceSlug: 's',
      waitUntil: (_p: Promise<unknown>) => {},
      mirrorOrigin: 'inbound',
    } as any)
    expect(prCommentMirrorService.scheduleOutbound).not.toHaveBeenCalled()
  })

  it('updateCommentWithSideEffects calls scheduleOutbound op=UPDATE', async () => {
    ;(commentRepository.update as jest.Mock).mockResolvedValue({ id: 'c1' })
    await commentService.updateCommentWithSideEffects({
      commentId: 'c1',
      body: '<p>edit</p>',
      waitUntil: (_p: Promise<unknown>) => {},
    })
    expect(prCommentMirrorService.scheduleOutbound).toHaveBeenCalledWith(
      'c1',
      'UPDATE',
      { mirrorOrigin: 'user' }
    )
  })

  it('deleteCommentWithSideEffects calls scheduleOutbound op=DELETE', async () => {
    ;(commentRepository.delete as jest.Mock).mockResolvedValue(undefined)
    await commentService.deleteCommentWithSideEffects({
      commentId: 'c1',
      waitUntil: (_p: Promise<unknown>) => {},
    })
    expect(prCommentMirrorService.scheduleOutbound).toHaveBeenCalledWith(
      'c1',
      'DELETE',
      { mirrorOrigin: 'user' }
    )
  })
})
