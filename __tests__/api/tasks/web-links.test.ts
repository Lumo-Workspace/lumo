/** @jest-environment node */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  requireWorkspaceMember: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  taskRepository: { findWithProjectWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services/task-web-link.service', () => ({
  taskWebLinkService: {
    listForTask: jest.fn(),
    addWebLink: jest.fn(),
    unlinkWebLink: jest.fn(),
    refreshWebLink: jest.fn(),
  },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskWebLinkService } from '@/lib/services/task-web-link.service'
import { GET, POST } from '@/app/api/tasks/[id]/web-links/route'
import { DELETE } from '@/app/api/tasks/[id]/web-links/[linkId]/route'
import { POST as REFRESH } from '@/app/api/tasks/[id]/web-links/[linkId]/refresh/route'

const authMock = requireAuth as jest.Mock
const memberMock = requireWorkspaceMember as jest.Mock
const findTaskMock = taskRepository.findWithProjectWorkspaceId as jest.Mock
const listMock = taskWebLinkService.listForTask as jest.Mock
const addMock = taskWebLinkService.addWebLink as jest.Mock
const unlinkMock = taskWebLinkService.unlinkWebLink as jest.Mock
const refreshMock = taskWebLinkService.refreshWebLink as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  authMock.mockResolvedValue({ userId: 'usr_clerk' })
  findTaskMock.mockResolvedValue({
    id: 'tsk_1',
    project: { workspaceId: 'ws_1' },
  })
  memberMock.mockResolvedValue({
    id: 'mem_1',
    workspaceId: 'ws_1',
    clerkId: 'usr_clerk',
  })
})

function jsonReq(body: unknown): NextRequest {
  return {
    json: async () => body,
  } as unknown as NextRequest
}

const paramsP = (p: Record<string, string>) =>
  ({ params: Promise.resolve(p) }) as { params: Promise<never> }

describe('GET /api/tasks/[id]/web-links', () => {
  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET({} as NextRequest, paramsP({ id: 'tsk_1' }))
    expect(res.status).toBe(401)
  })

  it('returns 404 when task not found', async () => {
    findTaskMock.mockResolvedValue(null)
    const res = await GET({} as NextRequest, paramsP({ id: 'tsk_X' }))
    expect(res.status).toBe(404)
  })

  it('returns 403 when not a workspace member', async () => {
    memberMock.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    )
    const res = await GET({} as NextRequest, paramsP({ id: 'tsk_1' }))
    expect(res.status).toBe(403)
  })

  it('returns webLinks on success', async () => {
    listMock.mockResolvedValue([{ id: 'wl_1' }])
    const res = await GET({} as NextRequest, paramsP({ id: 'tsk_1' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ webLinks: [{ id: 'wl_1' }] })
  })
})

describe('POST /api/tasks/[id]/web-links', () => {
  it('returns 400 on invalid body (missing url)', async () => {
    const res = await POST(jsonReq({}), paramsP({ id: 'tsk_1' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on javascript: URL', async () => {
    const res = await POST(
      jsonReq({ url: 'javascript:alert(1)' }),
      paramsP({ id: 'tsk_1' })
    )
    expect(res.status).toBe(400)
  })

  it('returns 201 with webLink on success', async () => {
    addMock.mockResolvedValue({ id: 'wl_1', url: 'https://example.com/' })
    const res = await POST(
      jsonReq({ url: 'https://example.com/' }),
      paramsP({ id: 'tsk_1' })
    )
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      webLink: { id: 'wl_1', url: 'https://example.com/' },
    })
    expect(addMock).toHaveBeenCalledWith({
      taskId: 'tsk_1',
      workspaceId: 'ws_1',
      url: 'https://example.com/',
      actorMemberId: 'mem_1',
    })
  })

  it('rejects unknown note field with 400', async () => {
    const res = await POST(
      jsonReq({ url: 'https://example.com/', note: 'nope' }),
      paramsP({ id: 'tsk_1' })
    )
    expect(res.status).toBe(400)
    expect(addMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/tasks/[id]/web-links/[linkId]', () => {
  it('returns 204 on success', async () => {
    unlinkMock.mockResolvedValue(undefined)
    const res = await DELETE(
      {} as NextRequest,
      paramsP({ id: 'tsk_1', linkId: 'wl_1' })
    )
    expect(res.status).toBe(204)
    expect(unlinkMock).toHaveBeenCalledWith('wl_1', 'ws_1')
  })

  it('propagates 404 from service', async () => {
    unlinkMock.mockRejectedValue(
      Object.assign(new Error('not_found'), { status: 404 })
    )
    const res = await DELETE(
      {} as NextRequest,
      paramsP({ id: 'tsk_1', linkId: 'wl_X' })
    )
    expect(res.status).toBe(404)
  })
})

describe('POST refresh', () => {
  it('returns updated webLink', async () => {
    refreshMock.mockResolvedValue({ id: 'wl_1', title: 'Updated' })
    const res = await REFRESH(
      {} as NextRequest,
      paramsP({ id: 'tsk_1', linkId: 'wl_1' })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      webLink: { id: 'wl_1', title: 'Updated' },
    })
  })
})
