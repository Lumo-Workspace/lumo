// __tests__/services/comment.service.no-pr-mirror.test.ts
jest.mock('@/lib/services/pr-comment-mirror.service', () => ({
  prCommentMirrorService: { scheduleOutbound: jest.fn() },
}))
jest.mock('@/lib/repositories/comment.repository')

import { commentService } from '@/lib/services/comment.service'
import { prCommentMirrorService } from '@/lib/services/pr-comment-mirror.service'
import { commentRepository } from '@/lib/repositories/comment.repository'

// LUM-1313: the PR ↔ task comment mirror is turned off — writing a task
// comment no longer posts, edits or deletes anything on the linked PR.
describe('commentService — no PR mirror', () => {
  beforeEach(() => jest.clearAllMocks())

  it('createCommentWithSideEffects does not schedule an outbound mirror', async () => {
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
    expect(commentRepository.create).toHaveBeenCalled()
    expect(prCommentMirrorService.scheduleOutbound).not.toHaveBeenCalled()
  })

  it('updateCommentWithSideEffects does not schedule an outbound mirror', async () => {
    ;(commentRepository.update as jest.Mock).mockResolvedValue({ id: 'c1' })
    await commentService.updateCommentWithSideEffects({
      commentId: 'c1',
      body: '<p>edit</p>',
      waitUntil: (_p: Promise<unknown>) => {},
    })
    expect(commentRepository.update).toHaveBeenCalled()
    expect(prCommentMirrorService.scheduleOutbound).not.toHaveBeenCalled()
  })

  it('deleteCommentWithSideEffects does not schedule an outbound mirror', async () => {
    ;(commentRepository.delete as jest.Mock).mockResolvedValue(undefined)
    await commentService.deleteCommentWithSideEffects({
      commentId: 'c1',
      waitUntil: (_p: Promise<unknown>) => {},
    })
    expect(commentRepository.delete).toHaveBeenCalledWith('c1')
    expect(prCommentMirrorService.scheduleOutbound).not.toHaveBeenCalled()
  })
})
