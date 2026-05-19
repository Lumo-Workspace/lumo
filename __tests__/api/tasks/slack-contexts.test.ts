/** @jest-environment node */
jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(),
  requireWorkspaceMember: jest.fn(),
}))
jest.mock('@/lib/repositories', () => ({
  taskRepository: { findWithProjectWorkspaceId: jest.fn() },
}))
jest.mock('@/lib/services/task-slack-context.service', () => ({
  taskSlackContextService: {
    listForTask: jest.fn(),
    linkSlackPermalink: jest.fn(),
    unlinkContext: jest.fn(),
    refreshContext: jest.fn(),
  },
}))

import { NextRequest, NextResponse } from 'next/server'
import { GET, POST } from '@/app/api/tasks/[id]/slack-contexts/route'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskSlackContextService } from '@/lib/services/task-slack-context.service'

const auth = requireAuth as jest.Mock
const member = requireWorkspaceMember as jest.Mock
const findTask = taskRepository.findWithProjectWorkspaceId as jest.Mock
const list = taskSlackContextService.listForTask as jest.Mock
const link = taskSlackContextService.linkSlackPermalink as jest.Mock

function mockRequest(body?: object) {
  return {
    json: async () => body ?? {},
  } as unknown as NextRequest
}
const params = { params: Promise.resolve({ id: 'tsk_1' }) }

beforeEach(() => jest.clearAllMocks())

describe('GET /api/tasks/[id]/slack-contexts', () => {
  it('returns 404 when task missing', async () => {
    auth.mockResolvedValue({ userId: 'clerk_1' })
    findTask.mockResolvedValue(null)
    const res = (await GET(mockRequest(), params)) as Response
    expect(res.status).toBe(404)
  })

  it('returns 403 when not a member', async () => {
    auth.mockResolvedValue({ userId: 'clerk_1' })
    findTask.mockResolvedValue({ project: { workspaceId: 'ws_1' } })
    member.mockResolvedValue(
      NextResponse.json({ error: 'no' }, { status: 403 })
    )
    const res = (await GET(mockRequest(), params)) as Response
    expect(res.status).toBe(403)
  })

  it('returns the list on success', async () => {
    auth.mockResolvedValue({ userId: 'clerk_1' })
    findTask.mockResolvedValue({ project: { workspaceId: 'ws_1' } })
    member.mockResolvedValue({ id: 'mem_1' })
    list.mockResolvedValue([{ id: 'ctx_1' }])
    const res = (await GET(mockRequest(), params)) as Response
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ contexts: [{ id: 'ctx_1' }] })
  })
})

describe('POST /api/tasks/[id]/slack-contexts', () => {
  it('returns 400 on bad payload', async () => {
    auth.mockResolvedValue({ userId: 'clerk_1' })
    findTask.mockResolvedValue({ project: { workspaceId: 'ws_1' } })
    member.mockResolvedValue({ id: 'mem_1' })
    const res = (await POST(
      mockRequest({ permalink: 'not a url' }),
      params
    )) as Response
    expect(res.status).toBe(400)
  })

  it('returns 201 with the created context on success', async () => {
    auth.mockResolvedValue({ userId: 'clerk_1' })
    findTask.mockResolvedValue({ project: { workspaceId: 'ws_1' } })
    member.mockResolvedValue({ id: 'mem_1' })
    link.mockResolvedValue({ id: 'ctx_new' })
    const res = (await POST(
      mockRequest({
        permalink: 'https://lumo.slack.com/archives/C9/p1700000000000100',
      }),
      params
    )) as Response
    expect(res.status).toBe(201)
    expect(link).toHaveBeenCalledWith({
      taskId: 'tsk_1',
      workspaceId: 'ws_1',
      permalink: 'https://lumo.slack.com/archives/C9/p1700000000000100',
      actorMemberId: 'mem_1',
    })
    expect(await res.json()).toEqual({ context: { id: 'ctx_new' } })
  })

  it('maps service status errors to HTTP status', async () => {
    auth.mockResolvedValue({ userId: 'clerk_1' })
    findTask.mockResolvedValue({ project: { workspaceId: 'ws_1' } })
    member.mockResolvedValue({ id: 'mem_1' })
    link.mockRejectedValue(
      Object.assign(new Error('not_in_channel'), { status: 403 })
    )
    const res = (await POST(
      mockRequest({
        permalink: 'https://lumo.slack.com/archives/C9/p1700000000000100',
      }),
      params
    )) as Response
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'not_in_channel' })
  })
})

import { DELETE } from '@/app/api/tasks/[id]/slack-contexts/[contextId]/route'

const unlink = taskSlackContextService.unlinkContext as jest.Mock

const deleteParams = {
  params: Promise.resolve({ id: 'tsk_1', contextId: 'ctx_1' }),
}

describe('DELETE /api/tasks/[id]/slack-contexts/[contextId]', () => {
  it('returns 204 on success', async () => {
    auth.mockResolvedValue({ userId: 'clerk_1' })
    findTask.mockResolvedValue({ project: { workspaceId: 'ws_1' } })
    member.mockResolvedValue({ id: 'mem_1' })
    unlink.mockResolvedValue(undefined)
    const res = (await DELETE(
      mockRequest() as unknown as NextRequest,
      deleteParams
    )) as Response
    expect(res.status).toBe(204)
    expect(unlink).toHaveBeenCalledWith('ctx_1')
  })

  it('returns 404 when service throws status 404', async () => {
    auth.mockResolvedValue({ userId: 'clerk_1' })
    findTask.mockResolvedValue({ project: { workspaceId: 'ws_1' } })
    member.mockResolvedValue({ id: 'mem_1' })
    unlink.mockRejectedValue(
      Object.assign(new Error('not_found'), { status: 404 })
    )
    const res = (await DELETE(
      mockRequest() as unknown as NextRequest,
      deleteParams
    )) as Response
    expect(res.status).toBe(404)
  })
})

import { POST as REFRESH } from '@/app/api/tasks/[id]/slack-contexts/[contextId]/refresh/route'

const refresh = taskSlackContextService.refreshContext as jest.Mock

const refreshParams = {
  params: Promise.resolve({ id: 'tsk_1', contextId: 'ctx_1' }),
}

describe('POST refresh', () => {
  it('returns 200 with updated context on success', async () => {
    auth.mockResolvedValue({ userId: 'clerk_1' })
    findTask.mockResolvedValue({ project: { workspaceId: 'ws_1' } })
    member.mockResolvedValue({ id: 'mem_1' })
    refresh.mockResolvedValue({ id: 'ctx_1', refreshError: null })
    const res = (await REFRESH(
      mockRequest() as unknown as NextRequest,
      refreshParams
    )) as Response
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      context: { id: 'ctx_1', refreshError: null },
    })
  })

  it('returns 403 when service maps to not_in_channel', async () => {
    auth.mockResolvedValue({ userId: 'clerk_1' })
    findTask.mockResolvedValue({ project: { workspaceId: 'ws_1' } })
    member.mockResolvedValue({ id: 'mem_1' })
    refresh.mockRejectedValue(
      Object.assign(new Error('not_in_channel'), { status: 403 })
    )
    const res = (await REFRESH(
      mockRequest() as unknown as NextRequest,
      refreshParams
    )) as Response
    expect(res.status).toBe(403)
  })
})
