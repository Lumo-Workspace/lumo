/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  memoryRepository: { findByIdWithWorkspace: jest.fn() },
}))
// LUM-1230: ref resolution is covered in memories-ref.test.ts; here the
// route's own branches are under test, so refs pass through unchanged.
jest.mock('@/lib/services/memory/memory-read.service', () => ({
  getMemoryByIdForWorkspace: jest.fn(),
  resolveMemoryRef: jest.fn(async (ref: string) => ref),
}))
jest.mock('@/lib/services', () => ({
  memoryManagementService: {
    editContent: jest.fn(),
    promoteToProject: jest.fn(),
  },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { memoryRepository } from '@/lib/repositories'
import { memoryManagementService } from '@/lib/services'
import { PATCH } from '@/app/api/memories/[memoryId]/route'

const ID = { workspaceId: 'w1', memberId: 'm1', source: 'bearer' }
const params = (memoryId: string) => ({ params: Promise.resolve({ memoryId }) })
const body = (b: unknown) =>
  new NextRequest('http://x/api/memories/m1', {
    method: 'PATCH',
    body: JSON.stringify(b),
  })

beforeEach(() => jest.clearAllMocks())

const TASK_MEM = {
  id: 'm1',
  workspaceId: 'w1',
  projectId: 'p1',
  taskId: 't1',
  scope: 'TASK',
  category: 'TRAP',
}

it('200 content-only edit calls editContent', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue(
    TASK_MEM
  )
  ;(memoryManagementService.editContent as jest.Mock).mockResolvedValue({
    id: 'm1',
  })
  const res = await PATCH(
    body({ content: { trigger: 'x', outcome: 'y' } }),
    params('m1')
  )
  expect(res.status).toBe(200)
  expect(memoryManagementService.editContent).toHaveBeenCalledWith('m1', {
    trigger: 'x',
    outcome: 'y',
  })
  expect(memoryManagementService.promoteToProject).not.toHaveBeenCalled()
})

it('200 scope-only promote calls promoteToProject without content', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue(
    TASK_MEM
  )
  ;(memoryManagementService.promoteToProject as jest.Mock).mockResolvedValue({
    id: 'm1',
  })
  const res = await PATCH(body({ scope: 'PROJECT' }), params('m1'))
  expect(res.status).toBe(200)
  expect(memoryManagementService.promoteToProject).toHaveBeenCalledWith(
    'm1',
    undefined
  )
})

it('200 content+promote calls promoteToProject with content', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue(
    TASK_MEM
  )
  ;(memoryManagementService.promoteToProject as jest.Mock).mockResolvedValue({
    id: 'm1',
  })
  const res = await PATCH(
    body({ content: { trigger: 'x', outcome: 'y' }, scope: 'PROJECT' }),
    params('m1')
  )
  expect(res.status).toBe(200)
  expect(memoryManagementService.promoteToProject).toHaveBeenCalledWith('m1', {
    trigger: 'x',
    outcome: 'y',
  })
})

it('400 on empty body', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue(
    TASK_MEM
  )
  const res = await PATCH(body({}), params('m1'))
  expect(res.status).toBe(400)
})

it('400 when content does not match the category schema', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue(
    TASK_MEM
  )
  const res = await PATCH(body({ content: { trigger: 'x' } }), params('m1'))
  expect(res.status).toBe(400)
})

it('404 when the memory is missing', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue(null)
  const res = await PATCH(body({ scope: 'PROJECT' }), params('mX'))
  expect(res.status).toBe(404)
})

it('403 when the memory is in another workspace', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue({
    ...TASK_MEM,
    workspaceId: 'w2',
  })
  const res = await PATCH(body({ scope: 'PROJECT' }), params('m1'))
  expect(res.status).toBe(403)
})

it('409 when promoting an already-PROJECT memory', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue({
    ...TASK_MEM,
    scope: 'PROJECT',
  })
  ;(memoryManagementService.promoteToProject as jest.Mock).mockRejectedValue(
    Object.assign(new Error('Memory is already project-scoped'), {
      status: 409,
    })
  )
  const res = await PATCH(body({ scope: 'PROJECT' }), params('m1'))
  expect(res.status).toBe(409)
})
