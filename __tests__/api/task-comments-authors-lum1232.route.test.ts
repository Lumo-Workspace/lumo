/**
 * @jest-environment node
 *
 * LUM-1232 batch G (G2) — GET /api/tasks/[id]/comments returns each author's
 * display name, resolved inside the caller's workspace; a task in another
 * workspace stays refused and its comments are never read.
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/runtime/wait-until', () => ({ waitUntil: jest.fn() }))
jest.mock('@/lib/actor', () => ({ getHumanActorId: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: { findWithProjectWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services', () => ({
  commentService: { getCommentsWithAuthors: jest.fn() },
}))

import type { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { commentService } from '@/lib/services'
import { GET } from '@/app/api/tasks/[id]/comments/route'

const identity = {
  workspaceId: 'ws1',
  memberId: 'm1',
  clerkId: 'c1',
  source: 'bearer',
}
const params = { params: Promise.resolve({ id: 'task-1' }) }
const req = new Request('http://localhost/x') as unknown as NextRequest
const findTask = taskRepository.findWithProjectWorkspaceId as jest.Mock
const getWithAuthors = commentService.getCommentsWithAuthors as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireIdentity as jest.Mock).mockResolvedValue(identity)
})

describe('GET /api/tasks/[id]/comments — author names (LUM-1232)', () => {
  it('returns authorName, resolved in the caller workspace', async () => {
    findTask.mockResolvedValue({
      id: 'task-1',
      project: { workspaceId: 'ws1' },
    })
    getWithAuthors.mockResolvedValue([
      { id: 'cm1', authorActorId: 'a1', authorName: 'Chao Li', replies: [] },
    ])
    const res = await GET(req, params)
    expect(res.status).toBe(200)
    expect(getWithAuthors).toHaveBeenCalledWith('task-1', 'ws1')
    const body = (await res.json()) as {
      comments: Array<{ authorName: string }>
    }
    expect(body.comments[0]!.authorName).toBe('Chao Li')
  })

  it('a task in another workspace is refused and its comments are not read', async () => {
    findTask.mockResolvedValue({
      id: 'task-1',
      project: { workspaceId: 'ws-other' },
    })
    const res = await GET(req, params)
    expect([403, 404]).toContain(res.status)
    expect(getWithAuthors).not.toHaveBeenCalled()
  })

  it('an unknown task is 404', async () => {
    findTask.mockResolvedValue(null)
    const res = await GET(req, params)
    expect(res.status).toBe(404)
    expect(getWithAuthors).not.toHaveBeenCalled()
  })
})
