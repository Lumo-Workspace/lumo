/**
 * @jest-environment node
 */
import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { platformAdminService } from '@/lib/services/platform-admin.service'
import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'

jest.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin: jest.fn(),
}))
jest.mock('@/lib/services/platform-admin.service', () => ({
  platformAdminService: {
    listWorkspaces: jest.fn(),
    getWorkspace: jest.fn(),
    listUsers: jest.fn(),
    getUser: jest.fn(),
    usage: jest.fn(),
    overview: jest.fn(),
  },
}))
jest.mock('@/lib/services/platform-admin-audit.service', () => ({
  platformAdminAudit: { record: jest.fn(), list: jest.fn() },
}))

import { GET as listWorkspaces } from '@/app/api/admin/workspaces/route'
import { GET as getWorkspace } from '@/app/api/admin/workspaces/[id]/route'
import { GET as listUsers } from '@/app/api/admin/users/route'
import { GET as getUser } from '@/app/api/admin/users/[id]/route'
import { GET as getUsage } from '@/app/api/admin/usage/route'
import { GET as getAudit } from '@/app/api/admin/audit/route'
import { GET as getOverview } from '@/app/api/admin/overview/route'

const guard = requirePlatformAdmin as jest.Mock
const svc = platformAdminService as jest.Mocked<typeof platformAdminService>
const audit = platformAdminAudit as jest.Mocked<typeof platformAdminAudit>

const ADMIN = { userId: 'admin-1', email: 'a@x.com' }
const idParams = { params: Promise.resolve({ id: 'ws-1' }) }
const req = (path: string) => new Request(`http://localhost/api/admin/${path}`)

type Handler = (r: Request, ctx: never) => Promise<Response>
const routes: [string, Handler, string][] = [
  ['workspaces', listWorkspaces as Handler, 'workspaces'],
  ['workspaces/[id]', getWorkspace as Handler, 'workspaces/ws-1'],
  ['users', listUsers as Handler, 'users'],
  ['users/[id]', getUser as Handler, 'users/u-1'],
  ['usage', getUsage as Handler, 'usage'],
  ['audit', getAudit as Handler, 'audit'],
  ['overview', getOverview as Handler, 'overview'],
]

describe('/api/admin read routes', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    guard.mockResolvedValue(ADMIN)
    audit.record.mockResolvedValue(undefined)
  })

  it.each(routes)(
    'every /api/admin read route returns 403 for a non-admin (%s)',
    async (_name, handler, path) => {
      guard.mockResolvedValue(
        NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      )
      const res = await handler(req(path), idParams as never)
      expect(res.status).toBe(403)
      expect(audit.record).not.toHaveBeenCalled()
      for (const fn of Object.values(svc)) expect(fn).not.toHaveBeenCalled()
    }
  )

  it('GET /api/admin/workspaces/[id] records a workspace.view audit row with workspaceId', async () => {
    svc.getWorkspace.mockResolvedValue({ id: 'ws-1' } as never)
    const res = await getWorkspace(req('workspaces/ws-1'), idParams)
    expect(res.status).toBe(200)
    expect(audit.record).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      action: 'workspace.view',
      targetType: 'workspace',
      targetId: 'ws-1',
      workspaceId: 'ws-1',
    })
  })

  it('404 for an unknown workspace id records nothing', async () => {
    svc.getWorkspace.mockRejectedValue(
      Object.assign(new Error('Workspace not found'), { status: 404 })
    )
    const res = await getWorkspace(req('workspaces/nope'), idParams)
    expect(res.status).toBe(404)
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('GET /api/admin/users/[id] records user.view; 404 records nothing', async () => {
    svc.getUser.mockResolvedValue({ id: 'ws-1' } as never)
    await getUser(req('users/ws-1'), idParams)
    expect(audit.record).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      action: 'user.view',
      targetType: 'user',
      targetId: 'ws-1',
    })
    audit.record.mockClear()
    svc.getUser.mockRejectedValue(
      Object.assign(new Error('User not found'), { status: 404 })
    )
    expect((await getUser(req('users/x'), idParams)).status).toBe(404)
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('list routes parse q/cursor/limit, record the .list action with the query', async () => {
    svc.listWorkspaces.mockResolvedValue({ items: [], nextCursor: null })
    const res = await listWorkspaces(
      req('workspaces?q=acme&limit=10&cursor=c1')
    )
    expect(await res.json()).toEqual({ items: [], nextCursor: null })
    expect(svc.listWorkspaces).toHaveBeenCalledWith({
      q: 'acme',
      cursor: 'c1',
      limit: 10,
    })
    expect(audit.record).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      action: 'workspace.list',
      targetType: 'workspace',
      targetId: '*',
      metadata: { query: { q: 'acme', cursor: 'c1', limit: 10 } },
    })
  })

  it('list defaults limit to 50 and rejects limit > 100 with 400', async () => {
    svc.listUsers.mockResolvedValue({ items: [], nextCursor: null })
    await listUsers(req('users'))
    expect(svc.listUsers).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50 })
    )
    audit.record.mockClear()
    expect((await listUsers(req('users?limit=101'))).status).toBe(400)
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('usage validates month and audits the resolved month', async () => {
    expect((await getUsage(req('usage?month=2026-13'))).status).toBe(400)
    svc.usage.mockResolvedValue({
      month: '2026-10',
      totalUsdMicros: '0',
      byWorkspace: [],
    })
    await getUsage(req('usage'))
    expect(svc.usage).toHaveBeenCalledWith(undefined)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'usage.view',
        targetType: 'usage',
        targetId: '2026-10',
      })
    )
  })

  it('overview audits usage.view / overview', async () => {
    svc.overview.mockResolvedValue({
      workspaceCount: 1,
      userCount: 1,
      pendingWaitlistCount: 0,
      currentMonthUsdMicros: '0',
    })
    await getOverview(req('overview'))
    expect(audit.record).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      action: 'usage.view',
      targetType: 'usage',
      targetId: 'overview',
    })
  })

  it('audit passes filters to platformAdminAudit.list and records audit.list', async () => {
    audit.list.mockResolvedValue({ items: [], nextCursor: null })
    const res = await getAudit(
      req('audit?adminUserId=a1&targetType=workspace&targetId=w1&cursor=c')
    )
    expect(res.status).toBe(200)
    expect(audit.list).toHaveBeenCalledWith({
      adminUserId: 'a1',
      targetType: 'workspace',
      targetId: 'w1',
      cursor: 'c',
      limit: 50,
    })
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'audit.list', targetType: 'audit' })
    )
    expect((await getAudit(req('audit?targetType=bogus'))).status).toBe(400)
  })

  it('a failed audit write fails the request (audit-before-respond)', async () => {
    svc.overview.mockResolvedValue({} as never)
    audit.record.mockRejectedValue(new Error('db down'))
    expect((await getOverview(req('overview'))).status).toBe(500)
  })
})
