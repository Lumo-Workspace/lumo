/** @jest-environment node */
// LUM-1230: ref resolution is covered in task-resource-ref tests; here the
// routes' own behaviour is under test, so ids pass through unchanged.
jest.mock('@/lib/services/task-resource-ref.service', () => ({
  resolveTaskResourceRef: jest.fn(
    async (_kind: string, _taskId: string, ref: string) => ref
  ),
}))
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findByIdForMention: jest.fn(),
    findByWorkspaceIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-artifact.service', () => ({
  taskArtifactService: {
    getById: jest.fn(),
    removeArtifact: jest.fn(),
    updateArtifact: jest.fn(),
  },
}))

import { NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskArtifactService } from '@/lib/services/task-artifact.service'
import {
  GET,
  PATCH,
  DELETE,
} from '@/app/api/tasks/[id]/artifacts/[artifactId]/route'

const ID = { workspaceId: 'w1', memberId: 'm1', source: 'bearer' }
const params = (id: string, artifactId: string) => ({
  params: Promise.resolve({ id, artifactId }),
})

beforeEach(() => jest.clearAllMocks())

it('GET resolves LUM-N and returns the artifact', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
    id: 't1',
  })
  ;(taskArtifactService.getById as jest.Mock).mockResolvedValue({
    id: 'a1',
    kind: 'spec',
    title: 'Spec',
  })

  const req = new NextRequest('http://x/api/tasks/LUM-9/artifacts/a1')
  const res = await GET(req, params('LUM-9', 'a1'))
  expect(res.status).toBe(200)
  expect(taskRepository.findByWorkspaceIdentifier).toHaveBeenCalledWith(
    'w1',
    'LUM',
    9
  )
  expect(taskArtifactService.getById).toHaveBeenCalledWith('t1', 'a1')
  const body = (await res.json()) as { artifact: { id: string } }
  expect(body.artifact).toEqual({ id: 'a1', kind: 'spec', title: 'Spec' })
})

it('GET returns 404 when the task does not resolve', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue(
    null
  )
  const res = await GET(new NextRequest('http://x'), params('LUM-404', 'a1'))
  expect(res.status).toBe(404)
  expect(taskArtifactService.getById).not.toHaveBeenCalled()
})

it('GET returns 404 when the artifact is missing', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
    id: 't1',
  })
  ;(taskArtifactService.getById as jest.Mock).mockRejectedValue(
    Object.assign(new Error('Artifact not found'), { status: 404 })
  )
  const res = await GET(new NextRequest('http://x'), params('LUM-9', 'a-x'))
  expect(res.status).toBe(404)
  const body = (await res.json()) as { error: string }
  expect(body.error).toBe('Artifact not found')
})

function patchReq(body: unknown) {
  return new NextRequest('http://x/api/tasks/LUM-9/artifacts/a1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

it('PATCH updates kind/source and returns the refreshed artifact', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
    id: 't1',
  })
  ;(taskArtifactService.updateArtifact as jest.Mock).mockResolvedValue({
    id: 'a1',
    kind: 'plan',
    title: 'Spec',
    source: 'spec-kit',
  })

  const res = await PATCH(
    patchReq({ kind: 'plan', source: 'spec-kit' }),
    params('LUM-9', 'a1')
  )
  expect(res.status).toBe(200)
  expect(taskArtifactService.updateArtifact).toHaveBeenCalledWith('t1', 'a1', {
    kind: 'plan',
    source: 'spec-kit',
  })
  const body = (await res.json()) as { artifact: { source: string } }
  expect(body.artifact.source).toBe('spec-kit')
})

it('PATCH rejects an empty body with 400', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
    id: 't1',
  })
  const res = await PATCH(patchReq({}), params('LUM-9', 'a1'))
  expect(res.status).toBe(400)
  expect(taskArtifactService.updateArtifact).not.toHaveBeenCalled()
})

it('PATCH rejects content (not editable) with 400', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
    id: 't1',
  })
  const res = await PATCH(
    patchReq({ content: 'new body' }),
    params('LUM-9', 'a1')
  )
  expect(res.status).toBe(400)
  expect(taskArtifactService.updateArtifact).not.toHaveBeenCalled()
})

it('PATCH returns 404 when the artifact is missing', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
    id: 't1',
  })
  ;(taskArtifactService.updateArtifact as jest.Mock).mockRejectedValue(
    Object.assign(new Error('Artifact not found'), { status: 404 })
  )
  const res = await PATCH(patchReq({ kind: 'plan' }), params('LUM-9', 'a-x'))
  expect(res.status).toBe(404)
})

it('PATCH returns 404 when the task does not resolve', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue(
    null
  )
  const res = await PATCH(patchReq({ kind: 'plan' }), params('LUM-404', 'a1'))
  expect(res.status).toBe(404)
  expect(taskArtifactService.updateArtifact).not.toHaveBeenCalled()
})

it('DELETE returns 204 on success', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
    id: 't1',
  })
  ;(taskArtifactService.removeArtifact as jest.Mock).mockResolvedValue(
    undefined
  )

  const req = new NextRequest('http://x/api/tasks/LUM-9/artifacts/a1', {
    method: 'DELETE',
  })
  const res = await DELETE(req, params('LUM-9', 'a1'))
  expect(res.status).toBe(204)
  expect(taskArtifactService.removeArtifact).toHaveBeenCalledWith('t1', 'a1')
})

it('DELETE returns 404 when the artifact is missing', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue({
    id: 't1',
  })
  ;(taskArtifactService.removeArtifact as jest.Mock).mockRejectedValue(
    Object.assign(new Error('Artifact not found'), { status: 404 })
  )

  const req = new NextRequest('http://x/api/tasks/LUM-9/artifacts/a-x', {
    method: 'DELETE',
  })
  const res = await DELETE(req, params('LUM-9', 'a-x'))
  expect(res.status).toBe(404)
})

it('DELETE returns 404 when the task does not resolve', async () => {
  ;(requireIdentity as jest.Mock).mockResolvedValue(ID)
  ;(taskRepository.findByWorkspaceIdentifier as jest.Mock).mockResolvedValue(
    null
  )
  const req = new NextRequest('http://x/api/tasks/LUM-404/artifacts/a1', {
    method: 'DELETE',
  })
  const res = await DELETE(req, params('LUM-404', 'a1'))
  expect(res.status).toBe(404)
  expect(taskArtifactService.removeArtifact).not.toHaveBeenCalled()
})
