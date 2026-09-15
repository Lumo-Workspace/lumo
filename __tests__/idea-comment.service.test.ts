/** @jest-environment node */
// LUM-680: idea comments reuse the polymorphic Comment table via `ideaId`.
// These unit-test the service + the single-owner invariant with the repo /
// idea-resolution mocked (no prisma).
jest.mock('@/lib/repositories/comment.repository', () => ({
  commentRepository: {
    findByIdeaId: jest.fn(),
    createForIdea: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/idea-activity.repository', () => ({
  ideaActivityRepository: { create: jest.fn(), listByIdea: jest.fn() },
}))
jest.mock('@/lib/services/idea.service', () => ({
  resolveIdeaInTeam: jest.fn(),
}))

import { ideaCommentService } from '@/lib/services/idea-comment.service'
import { assertSingleCommentOwner } from '@/lib/comment-owner'
import { commentRepository } from '@/lib/repositories/comment.repository'
import { ideaActivityRepository } from '@/lib/repositories/idea-activity.repository'
import { resolveIdeaInTeam } from '@/lib/services/idea.service'

const IDEA = { id: 'idea-1', teamId: 'team-1' }
const TEAM = { id: 'team-1', identifier: 'LUM' }

beforeEach(() => {
  jest.clearAllMocks()
  ;(resolveIdeaInTeam as jest.Mock).mockResolvedValue({
    idea: IDEA,
    team: TEAM,
  })
})

describe('idea comment round-trips through ideaId', () => {
  it('creates a comment owned by the idea (ideaId set, taskId null) and lists it', async () => {
    const row = {
      id: 'c1',
      ideaId: 'idea-1',
      taskId: null,
      authorActorId: 'actor-1',
      body: 'first comment',
      createdAt: new Date('2026-07-05T00:00:00.000Z'),
    }
    ;(commentRepository.createForIdea as jest.Mock).mockResolvedValue(row)

    const created = await ideaCommentService.createComment({
      workspaceId: 'w1',
      ideaRef: 'LUM-I1',
      authorActorId: 'actor-1',
      body: 'first comment',
    })

    // Written against the resolved idea id — never a task id.
    expect(commentRepository.createForIdea).toHaveBeenCalledWith({
      ideaId: 'idea-1',
      authorActorId: 'actor-1',
      body: 'first comment',
      // LUM-783: the body is scanned on write; clean → null.
      contentSignals: null,
    })
    expect(created).toMatchObject({
      id: 'c1',
      body: 'first comment',
      replies: [],
    })

    // GET lists the same comment back in the thread.
    ;(commentRepository.findByIdeaId as jest.Mock).mockResolvedValue([row])
    const thread = await ideaCommentService.listComments({
      workspaceId: 'w1',
      ideaRef: 'LUM-I1',
    })
    expect(commentRepository.findByIdeaId).toHaveBeenCalledWith('idea-1')
    expect(thread).toHaveLength(1)
    expect(thread[0]).toMatchObject({
      id: 'c1',
      body: 'first comment',
      replies: [],
    })
  })

  it('records a COMMENT_ADDED activity for the posted comment', async () => {
    ;(commentRepository.createForIdea as jest.Mock).mockResolvedValue({
      id: 'c2',
      ideaId: 'idea-1',
      taskId: null,
      authorActorId: 'actor-1',
      body: 'hello',
      createdAt: new Date(0),
    })

    await ideaCommentService.createComment({
      workspaceId: 'w1',
      ideaRef: 'LUM-I1',
      authorActorId: 'actor-1',
      body: 'hello',
    })

    expect(ideaActivityRepository.create).toHaveBeenCalledWith({
      ideaId: 'idea-1',
      actorId: 'actor-1',
      type: 'COMMENT_ADDED',
      payload: { commentId: 'c2' },
    })
  })
})

describe('comment requires exactly one owner', () => {
  it('rejects a comment with neither owner (400)', () => {
    expect(() => assertSingleCommentOwner({})).toThrow()
    expect(() =>
      assertSingleCommentOwner({ taskId: null, ideaId: null })
    ).toThrow()
    try {
      assertSingleCommentOwner({})
    } catch (e) {
      expect((e as { status?: number }).status).toBe(400)
    }
  })

  it('rejects a comment with both owners (400)', () => {
    expect(() =>
      assertSingleCommentOwner({ taskId: 't1', ideaId: 'i1' })
    ).toThrow()
  })

  it('accepts a task-only owner (existing task-comment path still works)', () => {
    expect(() => assertSingleCommentOwner({ taskId: 't1' })).not.toThrow()
    expect(() =>
      assertSingleCommentOwner({ taskId: 't1', ideaId: null })
    ).not.toThrow()
  })

  it('accepts an idea-only owner', () => {
    expect(() => assertSingleCommentOwner({ ideaId: 'i1' })).not.toThrow()
  })
})
