// __tests__/services/comment.service.no-pr-mirror.test.ts
// The factory only runs if something in comment.service's import graph
// requires the mirror service — so it doubles as a "nothing loads it" guard.
// (A flag on globalThis: the hoisted factory runs before module-level consts.)
const mockScheduleOutbound = jest.fn()
jest.mock('@/lib/services/pr-comment-mirror.service', () => {
  ;(globalThis as { __prMirrorLoaded?: boolean }).__prMirrorLoaded = true
  return {
    prCommentMirrorService: {
      scheduleOutbound: (...args: unknown[]) => mockScheduleOutbound(...args),
    },
  }
})
jest.mock('@/lib/repositories/comment.repository')

import { commentService } from '@/lib/services/comment.service'
import { commentRepository } from '@/lib/repositories/comment.repository'

const mirrorLoadedAtImport =
  (globalThis as { __prMirrorLoaded?: boolean }).__prMirrorLoaded === true

// LUM-1313: the PR ↔ task comment mirror is turned off — writing a task
// comment no longer posts, edits or deletes anything on the linked PR.
describe('commentService — no PR mirror', () => {
  it('does not load the PR comment mirror at all', () => {
    expect(mirrorLoadedAtImport).toBe(false)
  })

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
    expect(mockScheduleOutbound).not.toHaveBeenCalled()
  })

  it('updateCommentWithSideEffects does not schedule an outbound mirror', async () => {
    ;(commentRepository.update as jest.Mock).mockResolvedValue({ id: 'c1' })
    await commentService.updateCommentWithSideEffects({
      commentId: 'c1',
      body: '<p>edit</p>',
      waitUntil: (_p: Promise<unknown>) => {},
    })
    expect(commentRepository.update).toHaveBeenCalled()
    expect(mockScheduleOutbound).not.toHaveBeenCalled()
  })

  it('deleteCommentWithSideEffects does not schedule an outbound mirror', async () => {
    ;(commentRepository.delete as jest.Mock).mockResolvedValue(undefined)
    await commentService.deleteCommentWithSideEffects({
      commentId: 'c1',
      waitUntil: (_p: Promise<unknown>) => {},
    })
    expect(commentRepository.delete).toHaveBeenCalledWith('c1')
    expect(mockScheduleOutbound).not.toHaveBeenCalled()
  })
})
