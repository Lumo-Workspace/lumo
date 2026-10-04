/**
 * @jest-environment node
 *
 * LUM-970: /api/task-templates routes — thin wrappers that pass the caller's
 * workspace + role to the service (which owns the OWNER rule).
 */
import { NextRequest, NextResponse } from 'next/server'

const mockRequireIdentity = jest.fn()
const mockRequireAuth = jest.fn()
const mockRequireUserWorkspace = jest.fn()

jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: unknown[]) => mockRequireIdentity(...a),
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
}))
jest.mock('@/lib/api/helpers', () => {
  const actual = jest.requireActual('@/lib/api/helpers')
  return {
    ...actual,
    requireUserWorkspace: (...a: unknown[]) => mockRequireUserWorkspace(...a),
  }
})
jest.mock('@/lib/services/task-template.service', () => ({
  taskTemplateService: {
    listTemplates: jest.fn(),
    createTemplate: jest.fn(),
    updateTemplate: jest.fn(),
    deleteTemplate: jest.fn(),
  },
}))

import { GET, POST } from '@/app/api/task-templates/route'
import { PATCH, DELETE } from '@/app/api/task-templates/[id]/route'
import { taskTemplateService } from '@/lib/services/task-template.service'

const svc = taskTemplateService as unknown as Record<
  'listTemplates' | 'createTemplate' | 'updateTemplate' | 'deleteTemplate',
  jest.Mock
>

const params = { params: Promise.resolve({ id: 'tt_1' }) }

function req(url: string, init?: { method: string; body?: unknown }) {
  return new NextRequest(url, {
    method: init?.method ?? 'GET',
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireIdentity.mockResolvedValue({
    workspaceId: 'ws_1',
    memberId: 'm_1',
  })
  mockRequireAuth.mockResolvedValue({ userId: 'u_1' })
  mockRequireUserWorkspace.mockResolvedValue({
    workspaceId: 'ws_1',
    member: { role: 'MEMBER' },
  })
})

describe('GET /api/task-templates', () => {
  it('passes the locale and the caller member through', async () => {
    svc.listTemplates.mockResolvedValue([{ key: 'agent-brief' }])
    const res = await GET(req('http://localhost/api/task-templates?locale=ja'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ templates: [{ key: 'agent-brief' }] })
    expect(svc.listTemplates).toHaveBeenCalledWith('ws_1', {
      locale: 'ja',
      memberId: 'm_1',
    })
  })

  it('401s without auth', async () => {
    mockRequireIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    const res = await GET(req('http://localhost/api/task-templates'))
    expect(res.status).toBe(401)
    expect(svc.listTemplates).not.toHaveBeenCalled()
  })
})

describe('write routes', () => {
  const body = { key: 'bug-report', name: 'Bug', content: '## R' }

  it("a member's create surfaces the service's 403", async () => {
    svc.createTemplate.mockRejectedValue(
      Object.assign(
        new Error('Only workspace owners can manage task templates'),
        {
          status: 403,
        }
      )
    )
    const res = await POST(
      req('http://localhost/api/task-templates', { method: 'POST', body })
    )
    expect(res.status).toBe(403)
    expect(svc.createTemplate).toHaveBeenCalledWith('ws_1', 'MEMBER', body)
  })

  it('an invalid key is a 400 before the service runs', async () => {
    const res = await POST(
      req('http://localhost/api/task-templates', {
        method: 'POST',
        body: { ...body, key: 'Not A Slug' },
      })
    )
    expect(res.status).toBe(400)
    expect(svc.createTemplate).not.toHaveBeenCalled()
  })

  it('an owner creates (201), edits and deletes', async () => {
    mockRequireUserWorkspace.mockResolvedValue({
      workspaceId: 'ws_1',
      member: { role: 'OWNER' },
    })
    svc.createTemplate.mockResolvedValue({ id: 'tt_1' })
    svc.updateTemplate.mockResolvedValue({ id: 'tt_1', name: 'B2' })
    svc.deleteTemplate.mockResolvedValue(undefined)

    const created = await POST(
      req('http://localhost/api/task-templates', { method: 'POST', body })
    )
    expect(created.status).toBe(201)

    const patched = await PATCH(
      req('http://localhost/api/task-templates/tt_1', {
        method: 'PATCH',
        body: { name: 'B2' },
      }),
      params
    )
    expect(patched.status).toBe(200)
    expect(svc.updateTemplate).toHaveBeenCalledWith('ws_1', 'OWNER', 'tt_1', {
      name: 'B2',
    })

    const deleted = await DELETE(
      req('http://localhost/api/task-templates/tt_1', { method: 'DELETE' }),
      params
    )
    expect(deleted.status).toBe(200)
    expect(svc.deleteTemplate).toHaveBeenCalledWith('ws_1', 'OWNER', 'tt_1')
  })
})
