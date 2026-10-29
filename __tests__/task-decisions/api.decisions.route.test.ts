/**
 * @jest-environment node
 *
 * LUM-1303: the web decision routes are thin — auth → member of the task's
 * workspace → zod → service. Lock the 401/404 sources, that invalid input
 * never reaches the service, and that every call is pinned to the task's
 * workspace.
 */
import { NextRequest, NextResponse } from 'next/server'

const requireAuth = jest.fn()
const requireWorkspaceMember = jest.fn()
jest.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => requireAuth(...a),
  requireWorkspaceMember: (...a: unknown[]) => requireWorkspaceMember(...a),
}))
const findWithProjectWorkspaceId = jest.fn()
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findWithProjectWorkspaceId: (...a: unknown[]) =>
      findWithProjectWorkspaceId(...a),
  },
}))
jest.mock('@/lib/services/task-decision.service', () => ({
  taskDecisionService: {
    listForTask: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  },
}))

import { GET, POST } from '@/app/api/tasks/[id]/decisions/route'
import {
  PATCH,
  DELETE,
} from '@/app/api/tasks/[id]/decisions/[decisionId]/route'
import { taskDecisionService as svc } from '@/lib/services/task-decision.service'

const params = { params: Promise.resolve({ id: 't1', decisionId: 'd1' }) }
const req = (method: string, body?: unknown) =>
  new NextRequest('http://x/api/tasks/t1/decisions', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })

beforeEach(() => {
  jest.clearAllMocks()
  requireAuth.mockResolvedValue({ userId: 'u1' })
  findWithProjectWorkspaceId.mockResolvedValue({
    id: 't1',
    project: { workspaceId: 'ws_1' },
  })
  requireWorkspaceMember.mockResolvedValue({ id: 'mem_1' })
})

describe('/api/tasks/[id]/decisions', () => {
  it('GET lists the task decisions in its workspace', async () => {
    ;(svc.listForTask as jest.Mock).mockResolvedValue([{ id: 'd1' }])
    const res = await GET(req('GET'), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ decisions: [{ id: 'd1' }] })
    expect(svc.listForTask).toHaveBeenCalledWith('t1', 'ws_1')
  })

  it('POST records with the caller as author', async () => {
    ;(svc.create as jest.Mock).mockResolvedValue({ id: 'd1' })
    const res = await POST(
      req('POST', { text: 'keep v1', rationale: 'why' }),
      params
    )
    expect(res.status).toBe(201)
    expect(svc.create).toHaveBeenCalledWith({
      taskId: 't1',
      workspaceId: 'ws_1',
      text: 'keep v1',
      rationale: 'why',
      createdById: 'mem_1',
    })
  })

  it('POST rejects empty text before the service', async () => {
    const res = await POST(req('POST', { text: '   ' }), params)
    expect(res.status).toBe(400)
    expect(svc.create).not.toHaveBeenCalled()
  })

  it('401 when signed out, 404 for an unknown task', async () => {
    requireAuth.mockResolvedValueOnce(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    expect((await GET(req('GET'), params)).status).toBe(401)
    findWithProjectWorkspaceId.mockResolvedValueOnce(null)
    expect((await GET(req('GET'), params)).status).toBe(404)
    expect(svc.listForTask).not.toHaveBeenCalled()
  })
})

describe('/api/tasks/[id]/decisions/[decisionId]', () => {
  it('PATCH edits through the service; an empty body is a 400', async () => {
    ;(svc.update as jest.Mock).mockResolvedValue({ id: 'd1' })
    expect(
      (await PATCH(req('PATCH', { rationale: null }), params)).status
    ).toBe(200)
    expect(svc.update).toHaveBeenCalledWith({
      decisionId: 'd1',
      taskId: 't1',
      workspaceId: 'ws_1',
      actorMemberId: 'mem_1',
      rationale: null,
    })
    expect((await PATCH(req('PATCH', {}), params)).status).toBe(400)
  })

  it('DELETE returns 204, and a service 404 passes through', async () => {
    expect((await DELETE(req('DELETE'), params)).status).toBe(204)
    ;(svc.remove as jest.Mock).mockRejectedValueOnce(
      Object.assign(new Error('Decision not found'), { status: 404 })
    )
    expect((await DELETE(req('DELETE'), params)).status).toBe(404)
  })
})
