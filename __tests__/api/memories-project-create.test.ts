/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  projectRepository: { findWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services', () => ({
  memoryManagementService: {
    createForProject: jest.fn(),
    listProjectMemories: jest.fn(),
  },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { projectRepository } from '@/lib/repositories'
import { memoryManagementService } from '@/lib/services'
import { POST, GET } from '@/app/api/projects/[id]/memories/route'

const ID = { workspaceId: 'w1', memberId: 'm1', source: 'bearer' }
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const body = (b: unknown) =>
  new NextRequest('http://x/api/projects/p1/memories', {
    method: 'POST',
    body: JSON.stringify(b),
  })

beforeEach(() => jest.clearAllMocks())

it('201 creates a project memory with the actor', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(projectRepository.findWorkspaceId as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
  })
  ;(memoryManagementService.createForProject as jest.Mock).mockResolvedValue({
    id: 'mem1',
  })
  const res = await POST(
    body({ category: 'TRAP', content: { trigger: 'x', outcome: 'y' } }),
    params('p1')
  )
  expect(res.status).toBe(201)
  expect(memoryManagementService.createForProject).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: 'p1',
      workspaceId: 'w1',
      category: 'TRAP',
      actorMemberId: 'm1',
    })
  )
})

it('404 when the project does not exist', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(projectRepository.findWorkspaceId as jest.Mock).mockResolvedValue(null)
  const res = await POST(body({ category: 'TRAP', content: {} }), params('pX'))
  expect(res.status).toBe(404)
})

it('403 when the project is in another workspace', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(projectRepository.findWorkspaceId as jest.Mock).mockResolvedValue({
    workspaceId: 'w2',
  })
  const res = await POST(body({ category: 'TRAP', content: {} }), params('p1'))
  expect(res.status).toBe(403)
})

it('400 when content does not match the category schema', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(projectRepository.findWorkspaceId as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
  })
  const res = await POST(
    body({ category: 'TRAP', content: { trigger: 'x' } }),
    params('p1')
  )
  expect(res.status).toBe(400)
})

it('201 forwards agent to createForProject when valid agent is provided', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(projectRepository.findWorkspaceId as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
  })
  ;(memoryManagementService.createForProject as jest.Mock).mockResolvedValue({
    id: 'mem2',
  })
  const res = await POST(
    body({
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
      agent: 'CODEX',
    }),
    params('p1')
  )
  expect(res.status).toBe(201)
  expect(memoryManagementService.createForProject).toHaveBeenCalledWith(
    expect.objectContaining({ agent: 'CODEX' })
  )
})

it('400 when agent is not a valid TaskArtifactAgent', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(projectRepository.findWorkspaceId as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
  })
  const res = await POST(
    body({
      category: 'TRAP',
      content: { trigger: 'x', outcome: 'y' },
      agent: 'not-an-agent',
    }),
    params('p1')
  )
  expect(res.status).toBe(400)
})

it('401 when unauthenticated', async () => {
  const { NextResponse } = await import('next/server')
  ;(requireIdentity as jest.Mock).mockResolvedValue(
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  )
  const res = await POST(body({ category: 'TRAP', content: {} }), params('p1'))
  expect(res.status).toBe(401)
})

it('GET 200 returns project memories', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(projectRepository.findWorkspaceId as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
  })
  ;(memoryManagementService.listProjectMemories as jest.Mock).mockResolvedValue(
    [{ id: 'm1' }]
  )
  const res = await GET(
    new NextRequest('http://x/api/projects/p1/memories'),
    params('p1')
  )
  expect(res.status).toBe(200)
  expect(await res.json()).toEqual({ memories: [{ id: 'm1' }] })
})
