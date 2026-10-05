/**
 * @jest-environment node
 *
 * LUM-907 PR2: GET /api/workspaces/me/audit-events (+ /export) — thin
 * routes: identity → Zod → audit query service → response. The workspace
 * comes from the authenticated identity, never the query string.
 */
import { NextRequest, NextResponse } from 'next/server'

const mockRequireIdentity = jest.fn()
const mockList = jest.fn()
const mockExport = jest.fn()

jest.mock('@/lib/auth', () => ({
  requireIdentity: (...a: unknown[]) => mockRequireIdentity(...a),
}))
jest.mock('@/lib/services/audit-query.service', () => ({
  auditQueryService: {
    list: (...a: unknown[]) => mockList(...a),
    exportCsv: (...a: unknown[]) => mockExport(...a),
  },
}))

import { GET as listGET } from '@/app/api/workspaces/me/audit-events/route'
import { GET as exportGET } from '@/app/api/workspaces/me/audit-events/export/route'

const identity = {
  clerkId: 'user_owner',
  memberId: 'm_owner',
  workspaceId: 'ws_mine',
  workspaceSlug: 'acme',
  workspaceName: 'Acme',
  source: 'bearer' as const,
}

const req = (path: string) => new NextRequest(`https://lumo.test${path}`)
const forbidden = () =>
  Object.assign(new Error('Only workspace owners can view the audit log'), {
    status: 403,
  })

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireIdentity.mockResolvedValue(identity)
})

describe('LUM-907 audit events routes', () => {
  it('audit routes: unauthenticated callers get the auth response', async () => {
    mockRequireIdentity.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
    expect((await listGET(req('/api/workspaces/me/audit-events'))).status).toBe(
      401
    )
    expect(
      (await exportGET(req('/api/workspaces/me/audit-events/export'))).status
    ).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
    expect(mockExport).not.toHaveBeenCalled()
  })

  it('audit routes: a MEMBER gets 403 from list and export', async () => {
    mockList.mockRejectedValue(forbidden())
    mockExport.mockRejectedValue(forbidden())
    const list = await listGET(req('/api/workspaces/me/audit-events'))
    expect(list.status).toBe(403)
    expect(await list.json()).toEqual({
      error: 'Only workspace owners can view the audit log',
    })
    const csv = await exportGET(req('/api/workspaces/me/audit-events/export'))
    expect(csv.status).toBe(403)
  })

  it('audit routes: filters are validated and the identity workspace is used', async () => {
    mockList.mockResolvedValue({ events: [], nextCursor: null })
    const res = await listGET(
      req(
        '/api/workspaces/me/audit-events?action=invite&since=7d&limit=10&workspaceId=ws_other'
      )
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ events: [], nextCursor: null })
    expect(mockList).toHaveBeenCalledWith(
      { workspaceId: 'ws_mine', memberId: 'm_owner', clerkId: 'user_owner' },
      { action: 'invite', since: '7d', limit: 10 }
    )

    const bad = await listGET(
      req('/api/workspaces/me/audit-events?action=drop.everything')
    )
    expect(bad.status).toBe(400)
    const badLimit = await listGET(
      req('/api/workspaces/me/audit-events?limit=0')
    )
    expect(badLimit.status).toBe(400)
    expect(mockList).toHaveBeenCalledTimes(1)
  })

  it('audit routes: the export is a no-store CSV attachment with row count and truncation headers', async () => {
    mockExport.mockResolvedValue({
      csv: '"created_at"\r\n',
      rowCount: 0,
      truncated: false,
    })
    const res = await exportGET(
      req('/api/workspaces/me/audit-events/export?actor=me&until=2026-10-04')
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="lumo-audit-log-acme-\d{4}-\d{2}-\d{2}\.csv"$/
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-audit-row-count')).toBe('0')
    expect(res.headers.get('x-audit-truncated')).toBe('false')
    expect(await res.text()).toBe('"created_at"\r\n')
    expect(mockExport).toHaveBeenCalledWith(
      { workspaceId: 'ws_mine', memberId: 'm_owner', clerkId: 'user_owner' },
      { actor: 'me', until: '2026-10-04' }
    )
  })
})
