/** @jest-environment node */
/**
 * LUM-1230: /api/memories/[memoryId] accepts the CLI's 8-char short ref (or a
 * unique id prefix) as well as the full cuid, resolved inside the caller's
 * workspace only. Ambiguity is a 409 listing the candidates.
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    findByIdWithWorkspace: jest.fn(),
    findIdsMatchingRef: jest.fn(),
  },
}))
jest.mock('@/lib/repositories', () => ({
  memoryRepository: jest.requireMock('@/lib/repositories/memory.repository')
    .memoryRepository,
}))
jest.mock('@/lib/services', () => ({
  memoryManagementService: { delete: jest.fn(), promoteToProject: jest.fn() },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { memoryManagementService } from '@/lib/services'
import { DELETE, GET, PATCH } from '@/app/api/memories/[memoryId]/route'

const FULL = 'cmprcce99003304jrkp5brom5'
const OTHER = 'cmprcce99003404jrabcdefgh'
const ID = { workspaceId: 'w1', memberId: 'm1', source: 'bearer' }
const params = (memoryId: string) => ({ params: Promise.resolve({ memoryId }) })
const req = (method = 'GET', body?: unknown) =>
  new NextRequest('http://x/api/memories/x', {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
const repo = memoryRepository as unknown as {
  findByIdWithWorkspace: jest.Mock
  findIdsMatchingRef: jest.Mock
}

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
})

describe('GET /api/memories/[memoryId] with a short ref', () => {
  it('resolves the 8-char tail inside the caller workspace', async () => {
    repo.findIdsMatchingRef.mockResolvedValue([{ id: FULL, category: 'TRAP' }])
    repo.findByIdWithWorkspace.mockResolvedValue({
      id: FULL,
      workspaceId: 'w1',
      category: 'TRAP',
      content: {},
    })
    const res = await GET(req(), params('kp5brom5'))
    expect(res.status).toBe(200)
    expect(repo.findIdsMatchingRef).toHaveBeenCalledWith('w1', 'kp5brom5', 11)
    expect(repo.findByIdWithWorkspace).toHaveBeenCalledWith(FULL)
  })

  it('a full cuid still works and skips the ref lookup', async () => {
    repo.findByIdWithWorkspace.mockResolvedValue({
      id: FULL,
      workspaceId: 'w1',
    })
    const res = await GET(req(), params(FULL))
    expect(res.status).toBe(200)
    expect(repo.findIdsMatchingRef).not.toHaveBeenCalled()
  })

  it('404 for a short ref that only exists in another workspace', async () => {
    // The lookup is scoped to the caller's workspace, so the other
    // workspace's memory is never a candidate.
    repo.findIdsMatchingRef.mockResolvedValue([])
    const res = await GET(req(), params('kp5brom5'))
    expect(res.status).toBe(404)
    expect(repo.findIdsMatchingRef).toHaveBeenCalledWith('w1', 'kp5brom5', 11)
    expect(repo.findByIdWithWorkspace).not.toHaveBeenCalled()
  })

  it('409 listing every candidate when the prefix is ambiguous', async () => {
    repo.findIdsMatchingRef.mockResolvedValue([
      { id: FULL, category: 'TRAP' },
      { id: OTHER, category: 'DECISION' },
    ])
    const res = await GET(req(), params('cmprcce99'))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain(FULL)
    expect(body.error).toContain(OTHER)
    expect(repo.findByIdWithWorkspace).not.toHaveBeenCalled()
  })

  it('400 when the ref is shorter than 6 characters — without a DB query', async () => {
    const res = await GET(req(), params('kp5b'))
    expect(res.status).toBe(400)
    expect(repo.findIdsMatchingRef).not.toHaveBeenCalled()
  })

  it('a capped candidate list says "more than", not an exact count', async () => {
    repo.findIdsMatchingRef.mockResolvedValue(
      Array.from({ length: 11 }, (_, i) => ({
        id: `cmprcce99003304jrkp5b${String(i).padStart(4, '0')}`,
        category: 'TRAP',
      }))
    )
    const res = await GET(req(), params('cmprcce99'))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('matches more than 10, including')
    expect(body.error).not.toContain('cmprcce99003304jrkp5b0010')
  })
})

describe('PATCH / DELETE resolve the same short ref', () => {
  it('DELETE deletes the resolved full id', async () => {
    repo.findIdsMatchingRef.mockResolvedValue([{ id: FULL, category: 'TRAP' }])
    repo.findByIdWithWorkspace.mockResolvedValue({
      id: FULL,
      workspaceId: 'w1',
    })
    const res = await DELETE(req('DELETE'), params('kp5brom5'))
    expect(res.status).toBe(204)
    expect(memoryManagementService.delete).toHaveBeenCalledWith(
      FULL,
      expect.anything()
    )
  })

  it('PATCH promotes the resolved full id', async () => {
    repo.findIdsMatchingRef.mockResolvedValue([{ id: FULL, category: 'TRAP' }])
    repo.findByIdWithWorkspace.mockResolvedValue({
      id: FULL,
      workspaceId: 'w1',
      category: 'TRAP',
    })
    ;(memoryManagementService.promoteToProject as jest.Mock).mockResolvedValue({
      id: FULL,
    })
    const res = await PATCH(
      req('PATCH', { scope: 'PROJECT' }),
      params('kp5brom5')
    )
    expect(res.status).toBe(200)
    expect(memoryManagementService.promoteToProject).toHaveBeenCalledWith(
      FULL,
      undefined
    )
  })

  it('DELETE of a short ref from another workspace is a 404, nothing deleted', async () => {
    repo.findIdsMatchingRef.mockResolvedValue([])
    const res = await DELETE(req('DELETE'), params('kp5brom5'))
    expect(res.status).toBe(404)
    expect(memoryManagementService.delete).not.toHaveBeenCalled()
  })
})
