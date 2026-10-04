/**
 * @jest-environment node
 *
 * LUM-970: /api/task-templates routes — thin wrappers that pass the caller's
 * workspace + role to the service (which owns the OWNER rule).
 * LUM-974: the write routes accept a CLI bearer token as well as a browser
 * session (`requireIdentity`); the role comes from the service.
 */
import { NextRequest, NextResponse } from 'next/server'

const mockRequireIdentity = jest.fn()

jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: unknown[]) => mockRequireIdentity(...a),
}))
jest.mock('@/lib/services/task-template.service', () => ({
  taskTemplateService: {
    memberRole: jest.fn(),
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
  | 'memberRole'
  | 'listTemplates'
  | 'createTemplate'
  | 'updateTemplate'
  | 'deleteTemplate',
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
    source: 'clerk',
  })
  svc.memberRole.mockResolvedValue('MEMBER')
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
  const forbidden = () =>
    Object.assign(
      new Error('Only workspace owners can manage task templates'),
      { status: 403 }
    )

  async function createEditDelete() {
    const created = await POST(
      req('http://localhost/api/task-templates', { method: 'POST', body })
    )
    const patched = await PATCH(
      req('http://localhost/api/task-templates/tt_1', {
        method: 'PATCH',
        body: { name: 'B2' },
      }),
      params
    )
    const deleted = await DELETE(
      req('http://localhost/api/task-templates/tt_1', { method: 'DELETE' }),
      params
    )
    return [created.status, patched.status, deleted.status]
  }

  it.each(['bearer', 'clerk'] as const)(
    'an owner signed in via %s creates (201), edits and deletes',
    async source => {
      mockRequireIdentity.mockResolvedValue({
        workspaceId: 'ws_1',
        memberId: 'm_owner',
        source,
      })
      svc.memberRole.mockResolvedValue('OWNER')
      svc.createTemplate.mockResolvedValue({ id: 'tt_1' })
      svc.updateTemplate.mockResolvedValue({ id: 'tt_1', name: 'B2' })
      svc.deleteTemplate.mockResolvedValue(undefined)

      expect(await createEditDelete()).toEqual([201, 200, 200])
      expect(svc.memberRole).toHaveBeenCalledWith('m_owner')
      // LUM-907: the audit context names the member and how they signed in.
      const audit = expect.objectContaining({
        actor: expect.objectContaining({ memberId: 'm_owner' }),
        source: source === 'bearer' ? 'CLI' : 'WEB',
      })
      expect(svc.createTemplate).toHaveBeenCalledWith(
        'ws_1',
        'OWNER',
        body,
        audit
      )
      expect(svc.updateTemplate).toHaveBeenCalledWith(
        'ws_1',
        'OWNER',
        'tt_1',
        { name: 'B2' },
        audit
      )
      expect(svc.deleteTemplate).toHaveBeenCalledWith(
        'ws_1',
        'OWNER',
        'tt_1',
        audit
      )
    }
  )

  it.each(['bearer', 'clerk'] as const)(
    'a MEMBER signed in via %s is refused (403) on create, edit and delete',
    async source => {
      mockRequireIdentity.mockResolvedValue({
        workspaceId: 'ws_1',
        memberId: 'm_1',
        source,
      })
      svc.createTemplate.mockRejectedValue(forbidden())
      svc.updateTemplate.mockRejectedValue(forbidden())
      svc.deleteTemplate.mockRejectedValue(forbidden())

      expect(await createEditDelete()).toEqual([403, 403, 403])
      expect(svc.createTemplate).toHaveBeenCalledWith(
        'ws_1',
        'MEMBER',
        body,
        expect.anything()
      )
      expect(svc.deleteTemplate).toHaveBeenCalledWith(
        'ws_1',
        'MEMBER',
        'tt_1',
        expect.anything()
      )
    }
  )

  it('401s without a credential, before the service runs', async () => {
    mockRequireIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    expect(await createEditDelete()).toEqual([401, 401, 401])
    expect(svc.memberRole).not.toHaveBeenCalled()
    expect(svc.createTemplate).not.toHaveBeenCalled()
    expect(svc.updateTemplate).not.toHaveBeenCalled()
    expect(svc.deleteTemplate).not.toHaveBeenCalled()
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
})
