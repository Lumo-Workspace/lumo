/**
 * @jest-environment node
 */
import { NextResponse } from 'next/server'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { waitlistAdmin } from '@/lib/services/waitlist-admin.service'
import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'

jest.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin: jest.fn(),
}))
jest.mock('@/lib/services/waitlist-admin.service', () => ({
  waitlistAdmin: { list: jest.fn(), approve: jest.fn(), resend: jest.fn() },
}))
jest.mock('@/lib/services/platform-admin-audit.service', () => ({
  platformAdminAudit: { record: jest.fn() },
}))

import { GET as list } from '@/app/api/admin/waitlist/route'
import { POST as approve } from '@/app/api/admin/waitlist/[id]/approve/route'
import { POST as resend } from '@/app/api/admin/waitlist/[id]/resend/route'

const guard = requirePlatformAdmin as jest.Mock
const svc = waitlistAdmin as jest.Mocked<typeof waitlistAdmin>
const audit = platformAdminAudit as jest.Mocked<typeof platformAdminAudit>
const ADMIN = { userId: 'admin-1', email: 'a@x.com' }
const params = { params: Promise.resolve({ id: 'w1' }) }
const req = (path: string, method = 'GET') =>
  new Request(`http://localhost/api/admin/${path}`, { method })

type Handler = (r: Request, ctx: never) => Promise<Response>
const routes: [string, Handler, string, string][] = [
  ['list', list as Handler, 'waitlist', 'GET'],
  ['approve', approve as Handler, 'waitlist/w1/approve', 'POST'],
  ['resend', resend as Handler, 'waitlist/w1/resend', 'POST'],
]

describe('/api/admin/waitlist routes', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    guard.mockResolvedValue(ADMIN)
    audit.record.mockResolvedValue(undefined)
  })

  it.each(routes)('403 for a non-admin (%s)', async (_n, h, path, method) => {
    guard.mockResolvedValue(
      NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    )
    const res = await h(req(path, method), params as never)
    expect(res.status).toBe(403)
    expect(audit.record).not.toHaveBeenCalled()
    for (const fn of Object.values(svc)) expect(fn).not.toHaveBeenCalled()
  })

  it('list records waitlist.list', async () => {
    svc.list.mockResolvedValue({ items: [], nextCursor: null })
    const res = await list(req('waitlist?status=PENDING'))
    expect(res.status).toBe(200)
    expect(svc.list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING', limit: 50 })
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        adminUserId: 'admin-1',
        action: 'waitlist.list',
        targetType: 'waitlist',
        targetId: '*',
      })
    )
  })

  it('list rejects an invalid status with 400', async () => {
    const res = await list(req('waitlist?status=NOPE'))
    expect(res.status).toBe(400)
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('approve returns {entry,email}; the audit lives in the service', async () => {
    svc.approve.mockResolvedValue({
      entry: { id: 'w1' },
      email: 'failed',
    } as never)
    const res = await approve(req('waitlist/w1/approve', 'POST'), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ entry: { id: 'w1' }, email: 'failed' })
    expect(svc.approve).toHaveBeenCalledWith('w1', 'admin-1')
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('resend returns {entry,email}; the audit lives in the service', async () => {
    svc.resend.mockResolvedValue({
      entry: { id: 'w1' },
      email: 'sent',
    } as never)
    const res = await resend(req('waitlist/w1/resend', 'POST'), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ entry: { id: 'w1' }, email: 'sent' })
    expect(svc.resend).toHaveBeenCalledWith('w1', 'admin-1')
    expect(audit.record).not.toHaveBeenCalled()
  })

  it('resend 409 from the service is passed through', async () => {
    svc.resend.mockRejectedValue(
      Object.assign(new Error('not approved'), {
        status: 409,
        code: 'WAITLIST_NOT_APPROVED',
      })
    )
    const res = await resend(req('waitlist/w1/resend', 'POST'), params)
    expect(res.status).toBe(409)
    expect(audit.record).not.toHaveBeenCalled()
  })
})
