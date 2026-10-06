/**
 * @jest-environment node
 *
 * LUM-1002: GET/PATCH /api/workspaces/me/security-scan — bearer or Clerk via
 * requireIdentity, Zod body validation, service errors mapped to status.
 */
jest.mock('@/lib/auth/identity', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/security-scan-settings.service', () => ({
  securityScanSettingsService: { get: jest.fn(), update: jest.fn() },
}))

import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { securityScanSettingsService } from '@/lib/services/security-scan-settings.service'
import { GET, PATCH } from '@/app/api/workspaces/me/security-scan/route'

const m = <T>(fn: T) => fn as unknown as jest.Mock
const IDENTITY = {
  clerkId: 'u_1',
  memberId: 'm_1',
  workspaceId: 'ws_1',
  workspaceSlug: 'acme',
  workspaceName: 'Acme',
  source: 'bearer' as const,
}
const SETTINGS = { switches: {}, platform: {}, effective: {} }

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/workspaces/me/security-scan', {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  jest.resetAllMocks()
  m(requireIdentity).mockResolvedValue(IDENTITY)
  m(securityScanSettingsService.get).mockResolvedValue(SETTINGS)
  m(securityScanSettingsService.update).mockResolvedValue(SETTINGS)
})

it('GET returns the settings for the caller workspace', async () => {
  const res = await GET(req('GET'))
  expect(res.status).toBe(200)
  expect(securityScanSettingsService.get).toHaveBeenCalledWith(
    expect.objectContaining({ workspaceId: 'ws_1', memberId: 'm_1' })
  )
})

it('GET passes an auth failure through', async () => {
  m(requireIdentity).mockResolvedValue(
    NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  )
  expect((await GET(req('GET'))).status).toBe(401)
})

it('PATCH { all: false } calls the service with a CLI audit context', async () => {
  const res = await PATCH(req('PATCH', { all: false }))
  expect(res.status).toBe(200)
  const [caller, update, audit] = m(securityScanSettingsService.update).mock
    .calls[0]
  expect(caller).toMatchObject({ workspaceId: 'ws_1', memberId: 'm_1' })
  expect(update).toEqual({ all: false })
  expect(audit.source).toBe('CLI')
})

it.each([
  [{}, /Nothing to change/],
  [{ all: false, securityHuntEnabled: true }, /cannot be combined/],
  [{ bogus: true }, /./],
  [{ securityScanEnabled: 'no' }, /./],
])('PATCH rejects %j with 400', async (body, msg) => {
  const res = await PATCH(req('PATCH', body))
  expect(res.status).toBe(400)
  expect((await res.json()).error).toMatch(msg)
  expect(securityScanSettingsService.update).not.toHaveBeenCalled()
})

it('PATCH maps the OWNER-only 403', async () => {
  m(securityScanSettingsService.update).mockRejectedValue(
    Object.assign(new Error('Only admins can update workspace settings'), {
      status: 403,
    })
  )
  expect((await PATCH(req('PATCH', { all: false }))).status).toBe(403)
})
