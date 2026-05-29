/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: { findWithProjectWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services', () => ({
  memoryManagementService: { createForTask: jest.fn() },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { memoryManagementService } from '@/lib/services'
import { POST } from '@/app/api/tasks/[id]/memories/route'

const ID = { workspaceId: 'w1', memberId: 'm1', source: 'bearer' }
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const body = (b: unknown) =>
  new NextRequest('http://x/api/tasks/t1/memories', { method: 'POST', body: JSON.stringify(b) })

beforeEach(() => jest.clearAllMocks())

it('201 creates a task memory bound to the task', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findWithProjectWorkspaceId as jest.Mock).mockResolvedValue({ id: 't1', projectId: 'p1', project: { workspaceId: 'w1' } })
  ;(memoryManagementService.createForTask as jest.Mock).mockResolvedValue({ id: 'mem1' })
  const res = await POST(body({ category: 'DECISION', content: { what: 'a', why: 'b' } }), params('t1'))
  expect(res.status).toBe(201)
  expect(memoryManagementService.createForTask).toHaveBeenCalledWith(
    expect.objectContaining({ taskId: 't1', projectId: 'p1', workspaceId: 'w1', actorMemberId: 'm1' })
  )
})

it('404 when the task does not exist', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findWithProjectWorkspaceId as jest.Mock).mockResolvedValue(null)
  const res = await POST(body({ category: 'TRAP', content: {} }), params('tX'))
  expect(res.status).toBe(404)
})

it('403 when the task is in another workspace', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findWithProjectWorkspaceId as jest.Mock).mockResolvedValue({ id: 't1', projectId: 'p1', project: { workspaceId: 'w2' } })
  const res = await POST(body({ category: 'TRAP', content: {} }), params('t1'))
  expect(res.status).toBe(403)
})

it('400 when content does not match the category schema', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findWithProjectWorkspaceId as jest.Mock).mockResolvedValue({ id: 't1', projectId: 'p1', project: { workspaceId: 'w1' } })
  const res = await POST(body({ category: 'CONVENTION', content: { rule: 'r' } }), params('t1'))
  expect(res.status).toBe(400)
})
