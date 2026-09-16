/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  memoryRepository: { findByIdWithWorkspace: jest.fn() },
}))
jest.mock('@/lib/services', () => ({
  memoryManagementService: { delete: jest.fn() },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { memoryRepository } from '@/lib/repositories'
import { memoryManagementService } from '@/lib/services'
import { DELETE } from '@/app/api/memories/[memoryId]/route'

const ID = { workspaceId: 'w1', memberId: 'm1', source: 'bearer' }
const params = (memoryId: string) => ({ params: Promise.resolve({ memoryId }) })
const req = () =>
  new NextRequest('http://x/api/memories/m1', { method: 'DELETE' })

beforeEach(() => jest.clearAllMocks())

it('204 deletes the memory', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue({
    id: 'm1',
    workspaceId: 'w1',
  })
  ;(memoryManagementService.delete as jest.Mock).mockResolvedValue(undefined)
  const res = await DELETE(req(), params('m1'))
  expect(res.status).toBe(204)
  // LUM-793: the route hands the service the caller's identity + Claude Code
  // session so a used-TRAP deletion can be attributed to the bound task.
  expect(memoryManagementService.delete).toHaveBeenCalledWith('m1', {
    sessionId: null,
    memberId: 'm1',
    source: 'bearer',
  })
})

it('404 when the memory is missing', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue(null)
  const res = await DELETE(req(), params('mX'))
  expect(res.status).toBe(404)
})

it('403 when the memory is in another workspace', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(memoryRepository.findByIdWithWorkspace as jest.Mock).mockResolvedValue({
    id: 'm1',
    workspaceId: 'w2',
  })
  const res = await DELETE(req(), params('m1'))
  expect(res.status).toBe(403)
})
