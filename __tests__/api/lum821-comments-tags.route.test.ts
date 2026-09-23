/**
 * @jest-environment node
 *
 * LUM-821 P1: comment edit/delete open to CLI bearer auth, author-only;
 * POST /api/tags open to bearer.
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/actor', () => ({ getHumanActorId: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  commentRepository: { findByIdWithTask: jest.fn() },
}))
jest.mock('@/lib/services/comment.service', () => ({
  commentService: {
    updateCommentWithSideEffects: jest.fn(),
    deleteCommentWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/services', () => ({
  tagService: { listTags: jest.fn(), createTag: jest.fn() },
}))

import type { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { commentRepository } from '@/lib/repositories'
import { commentService } from '@/lib/services/comment.service'
import { tagService } from '@/lib/services'
import { DELETE, PATCH } from '@/app/api/tasks/[id]/comments/[commentId]/route'
import { POST as createTag } from '@/app/api/tags/route'

const identity = {
  workspaceId: 'ws1',
  memberId: 'm1',
  clerkId: 'c1',
  source: 'bearer',
}
const params = { params: Promise.resolve({ id: 'task-1', commentId: 'cm-1' }) }
const find = commentRepository.findByIdWithTask as jest.Mock
const comment = (over: Record<string, unknown> = {}) => ({
  id: 'cm-1',
  taskId: 'task-1',
  authorActorId: 'actor-me',
  deletedAt: null,
  task: { project: { workspaceId: 'ws1' } },
  ...over,
})
const req = (method: string, body?: unknown) =>
  new Request('http://localhost/x', {
    method,
    ...(body
      ? {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        }
      : {}),
  }) as unknown as NextRequest

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireIdentity as jest.Mock).mockResolvedValue(identity)
  ;(getHumanActorId as jest.Mock).mockResolvedValue('actor-me')
  find.mockResolvedValue(comment())
})

describe('PATCH/DELETE /api/tasks/[id]/comments/[commentId] over bearer', () => {
  it('author edits their comment', async () => {
    ;(
      commentService.updateCommentWithSideEffects as jest.Mock
    ).mockResolvedValue({ id: 'cm-1' })
    const res = await PATCH(req('PATCH', { body: 'new text' }), params)
    expect(res.status).toBe(200)
    expect(commentService.updateCommentWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 'cm-1', body: 'new text' })
    )
    expect(getHumanActorId).toHaveBeenCalledWith('m1')
  })

  it('author soft-deletes their comment', async () => {
    const res = await DELETE(req('DELETE'), params)
    expect(res.status).toBe(200)
    expect(commentService.deleteCommentWithSideEffects).toHaveBeenCalledWith(
      expect.objectContaining({ commentId: 'cm-1' })
    )
  })

  it('a non-author gets 403 and nothing is written', async () => {
    find.mockResolvedValue(comment({ authorActorId: 'actor-someone-else' }))
    expect((await PATCH(req('PATCH', { body: 'x' }), params)).status).toBe(403)
    expect((await DELETE(req('DELETE'), params)).status).toBe(403)
    expect(commentService.updateCommentWithSideEffects).not.toHaveBeenCalled()
    expect(commentService.deleteCommentWithSideEffects).not.toHaveBeenCalled()
  })

  it('another workspace or an already-deleted comment reads as 404', async () => {
    find.mockResolvedValue(
      comment({ task: { project: { workspaceId: 'ws-other' } } })
    )
    expect((await DELETE(req('DELETE'), params)).status).toBe(404)
    find.mockResolvedValue(comment({ deletedAt: new Date() }))
    expect((await PATCH(req('PATCH', { body: 'x' }), params)).status).toBe(404)
    expect(commentService.deleteCommentWithSideEffects).not.toHaveBeenCalled()
  })
})

describe('POST /api/tags over bearer', () => {
  it('creates a tag in the caller workspace', async () => {
    ;(tagService.createTag as jest.Mock).mockResolvedValue({
      id: 't1',
      name: 'bug',
    })
    const res = await createTag(req('POST', { name: 'bug', color: '#ff0000' }))
    expect(res.status).toBe(201)
    expect(tagService.createTag).toHaveBeenCalledWith('ws1', {
      name: 'bug',
      color: '#ff0000',
    })
  })
})
