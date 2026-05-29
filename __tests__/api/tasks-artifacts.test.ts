/** @jest-environment node */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-artifact.service', () => ({
  taskArtifactService: { listForTask: jest.fn(), addArtifact: jest.fn() },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskArtifactService } from '@/lib/services/task-artifact.service'
import { GET, POST } from '@/app/api/tasks/[id]/artifacts/route'

const ID = { workspaceId: 'w1', memberId: 'm1', source: 'bearer' }
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => jest.clearAllMocks())

it('POST resolves LUM-N and returns 201 with the created artifact', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
    id: 't1',
  })
  ;(taskArtifactService.addArtifact as jest.Mock).mockResolvedValue({
    id: 'a1',
    title: 'Spec',
  })

  const req = new NextRequest('http://x/api/tasks/LUM-9/artifacts', {
    method: 'POST',
    body: JSON.stringify({
      kind: 'spec',
      title: 'Spec',
      content: '## R',
      source: 'superpowers',
    }),
  })
  const res = await POST(req, params('LUM-9'))
  expect(res.status).toBe(201)
  expect(taskRepository.findByWorkspaceIdentifier).toHaveBeenCalledWith(
    'w1',
    'LUM',
    9
  )
  expect(taskArtifactService.addArtifact).toHaveBeenCalledWith(
    expect.objectContaining({
      taskId: 't1',
      workspaceId: 'w1',
      actorMemberId: 'm1',
    })
  )
})

it('POST returns 400 on invalid body', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
    id: 't1',
  })
  const req = new NextRequest('http://x/api/tasks/LUM-9/artifacts', {
    method: 'POST',
    body: JSON.stringify({ kind: '', title: 'Spec', content: 'x' }),
  })
  const res = await POST(req, params('LUM-9'))
  expect(res.status).toBe(400)
})

it('GET returns 404 when the task does not resolve', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue(
    null
  )
  const res = await GET(new NextRequest('http://x'), params('LUM-404'))
  expect(res.status).toBe(404)
})
