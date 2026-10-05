/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server'

jest.mock('@/lib/auth', () => ({
  requireAuth: jest.fn(async () => ({ userId: 'user1' })),
  requireWorkspaceMember: jest.fn(async () => ({
    id: 'mem1',
    role: 'OWNER',
  })),
}))
jest.mock('@/lib/api/helpers', () => ({
  requireWorkspaceByUrl: jest.fn(async () => ({ workspaceId: 'ws1' })),
}))
jest.mock('@/lib/services/sentry.service', () => ({
  sentryService: {
    listMappings: jest.fn(),
    createMapping: jest.fn(),
    deleteMapping: jest.fn(),
  },
}))

import { GET, POST } from '@/app/api/sentry/mappings/route'
import { DELETE } from '@/app/api/sentry/mappings/[id]/route'
import { sentryService } from '@/lib/services/sentry.service'

function req(url: string, body?: unknown, method = 'GET'): NextRequest {
  if (body !== undefined) {
    return new NextRequest(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }
  return new NextRequest(url, { method })
}

describe('GET /api/sentry/mappings', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns mappings', async () => {
    ;(sentryService.listMappings as jest.Mock).mockResolvedValue([{ id: 'm1' }])
    const res = await GET(req('http://x/api/sentry/mappings?workspaceUrl=acme'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'm1' }])
  })
})

describe('POST /api/sentry/mappings', () => {
  beforeEach(() => jest.clearAllMocks())

  it('rejects bad input with 400', async () => {
    const res = await POST(
      req(
        'http://x/api/sentry/mappings?workspaceUrl=acme',
        { sentryProjectSlug: '', projectId: '' },
        'POST'
      )
    )
    expect(res.status).toBe(400)
  })

  it('creates mapping with 200', async () => {
    ;(sentryService.createMapping as jest.Mock).mockResolvedValue({
      id: 'map1',
      sentryProjectSlug: 'frontend',
      projectId: 'p1',
    })
    const res = await POST(
      req(
        'http://x/api/sentry/mappings?workspaceUrl=acme',
        { sentryProjectSlug: 'frontend', projectId: 'p1' },
        'POST'
      )
    )
    expect(res.status).toBe(200)
  })

  it('returns 409 on duplicate', async () => {
    ;(sentryService.createMapping as jest.Mock).mockRejectedValue(
      Object.assign(new Error('dup'), { status: 409 })
    )
    const res = await POST(
      req(
        'http://x/api/sentry/mappings?workspaceUrl=acme',
        { sentryProjectSlug: 'frontend', projectId: 'p1' },
        'POST'
      )
    )
    expect(res.status).toBe(409)
  })
})

describe('DELETE /api/sentry/mappings/[id]', () => {
  beforeEach(() => jest.clearAllMocks())

  it('calls deleteMapping and returns 200', async () => {
    const res = await DELETE(
      req(
        'http://x/api/sentry/mappings/m1?workspaceUrl=acme',
        undefined,
        'DELETE'
      ),
      { params: Promise.resolve({ id: 'm1' }) }
    )
    expect(res.status).toBe(200)
    expect(sentryService.deleteMapping).toHaveBeenCalledWith(
      'ws1',
      'OWNER',
      'm1',
      expect.objectContaining({
        actor: { type: 'MEMBER', clerkId: 'user1', memberId: 'mem1' },
        source: 'WEB',
      })
    )
  })
})
