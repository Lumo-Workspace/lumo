/**
 * @jest-environment node
 *
 * LUM-821 P2 routes over CLI bearer: DELETE /api/tasks/by-identifier/[id],
 * GET /api/tasks/[id]/timeline (workspace-scoped), POST /api/projects,
 * PATCH /api/projects/[id], and the initiative PATCH / updates routes.
 */
jest.mock('@/lib/auth/bearer', () => ({ verifyBearer: jest.fn() }))
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
  requireAuth: jest.fn(),
}))
jest.mock('@/lib/services/task-cli.service', () => ({
  taskCliService: { deleteFromCli: jest.fn() },
}))
jest.mock('@/lib/services/next-steps.service', () => ({ nextStepsService: {} }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: { findWithProjectWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services', () => ({
  timelineService: { getTimeline: jest.fn() },
  projectService: { createProject: jest.fn(), updateProject: jest.fn() },
}))
jest.mock('@/lib/services/initiative.service', () => ({
  initiativeService: {
    update: jest.fn(),
    postProgressUpdate: jest.fn(),
    listProgressUpdates: jest.fn(),
    getDetail: jest.fn(),
  },
}))

import type { NextRequest } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { requireIdentity } from '@/lib/auth'
import { taskCliService } from '@/lib/services/task-cli.service'
import { taskRepository } from '@/lib/repositories'
import { projectService, timelineService } from '@/lib/services'
import { initiativeService } from '@/lib/services/initiative.service'
import { DELETE as deleteTask } from '@/app/api/tasks/by-identifier/[identifier]/route'
import { GET as timeline } from '@/app/api/tasks/[id]/timeline/route'
import { POST as createProject } from '@/app/api/projects/route'
import { PATCH as patchProject } from '@/app/api/projects/[id]/route'
import { PATCH as patchInitiative } from '@/app/api/initiatives/[initiativeId]/route'
import {
  GET as listUpdates,
  POST as postUpdate,
} from '@/app/api/initiatives/[initiativeId]/updates/route'

const identity = {
  workspaceId: 'ws1',
  workspaceSlug: 'lumo',
  memberId: 'm1',
  clerkId: 'c1',
  source: 'bearer',
}
const req = (method = 'GET', body?: unknown, url = 'http://localhost/x') =>
  new Request(url, {
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
  ;(verifyBearer as jest.Mock).mockResolvedValue({
    user: { id: 'c1' },
    workspace: { id: 'ws1', slug: 'lumo', name: 'Lumo' },
  })
})

describe('DELETE /api/tasks/by-identifier/[identifier]', () => {
  it('deletes within the bearer workspace', async () => {
    ;(taskCliService.deleteFromCli as jest.Mock).mockResolvedValue({
      identifier: 'LUM-9',
      title: 'x',
    })
    const res = await deleteTask(req('DELETE'), {
      params: Promise.resolve({ identifier: 'LUM-9' }),
    })
    expect(res.status).toBe(200)
    expect(taskCliService.deleteFromCli).toHaveBeenCalledWith({
      workspaceId: 'ws1',
      identifier: 'LUM-9',
      clerkId: 'c1',
    })
  })
  it('401 without a valid key; nothing deleted', async () => {
    ;(verifyBearer as jest.Mock).mockResolvedValue(null)
    const res = await deleteTask(req('DELETE'), {
      params: Promise.resolve({ identifier: 'LUM-9' }),
    })
    expect(res.status).toBe(401)
    expect(taskCliService.deleteFromCli).not.toHaveBeenCalled()
  })
})

describe('GET /api/tasks/[id]/timeline', () => {
  it('serves the timeline to a bearer caller in the same workspace', async () => {
    ;(taskRepository.findWithProjectWorkspaceId as jest.Mock).mockResolvedValue(
      { project: { workspaceId: 'ws1' } }
    )
    ;(timelineService.getTimeline as jest.Mock).mockResolvedValue({
      items: [],
      hasMore: false,
      nextCursor: null,
    })
    const res = await timeline(
      req('GET', undefined, 'http://localhost/x?limit=100'),
      { params: Promise.resolve({ id: 't1' }) }
    )
    expect(res.status).toBe(200)
    expect(timelineService.getTimeline).toHaveBeenCalledWith('t1', {
      limit: 100,
      cursor: undefined,
    })
  })
  it('another workspace’s task is 404', async () => {
    ;(taskRepository.findWithProjectWorkspaceId as jest.Mock).mockResolvedValue(
      { project: { workspaceId: 'ws-other' } }
    )
    const res = await timeline(req(), { params: Promise.resolve({ id: 't1' }) })
    expect(res.status).toBe(404)
    expect(timelineService.getTimeline).not.toHaveBeenCalled()
  })
})

describe('project routes over bearer', () => {
  it('POST creates in the identity workspace as the identity member', async () => {
    ;(projectService.createProject as jest.Mock).mockResolvedValue({
      id: 'p1',
      name: 'API',
    })
    const res = await createProject(req('POST', { name: 'API' }))
    expect(res.status).toBe(201)
    expect(projectService.createProject).toHaveBeenCalledWith(
      'ws1',
      'lumo',
      'm1',
      { name: 'API', isIdea: false }
    )
  })
  it('PATCH updates as the identity member (service scopes the workspace)', async () => {
    ;(projectService.updateProject as jest.Mock).mockResolvedValue({
      id: 'p1',
      name: 'API v2',
    })
    const res = await patchProject(req('PATCH', { name: 'API v2' }), {
      params: Promise.resolve({ id: 'p1' }),
    })
    expect(res.status).toBe(200)
    expect(projectService.updateProject).toHaveBeenCalledWith(
      'p1',
      'lumo',
      'm1',
      { name: 'API v2' }
    )
  })
})

describe('initiative routes', () => {
  const params = { params: Promise.resolve({ initiativeId: 'LUM-INIT-3' }) }
  it('PATCH validates then updates; invalid status is 400', async () => {
    ;(initiativeService.update as jest.Mock).mockResolvedValue({
      identifier: 'LUM-INIT-3',
    })
    expect(
      (await patchInitiative(req('PATCH', { status: 'COMPLETED' }), params))
        .status
    ).toBe(200)
    expect(
      (await patchInitiative(req('PATCH', { status: 'DONE' }), params)).status
    ).toBe(400)
    expect(initiativeService.update).toHaveBeenCalledTimes(1)
  })
  it('POST updates records the caller as author; service 404 passes through', async () => {
    ;(initiativeService.postProgressUpdate as jest.Mock).mockResolvedValue({
      id: 'u1',
    })
    expect(
      (await postUpdate(req('POST', { body: 'x', health: 'ON_TRACK' }), params))
        .status
    ).toBe(201)
    expect(initiativeService.postProgressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ authorMemberId: 'm1', ref: 'LUM-INIT-3' })
    )
    ;(initiativeService.listProgressUpdates as jest.Mock).mockRejectedValue(
      Object.assign(new Error('Initiative LUM-INIT-3 not found'), {
        status: 404,
      })
    )
    expect((await listUpdates(req(), params)).status).toBe(404)
  })
})
