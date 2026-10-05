/**
 * @jest-environment node
 */

import { NextRequest, NextResponse } from 'next/server'
import { GET } from '@/app/api/figma/callback/route'
import * as svc from '@/lib/services/figma-integration.service'
import * as auth from '@/lib/auth'

jest.mock('@/lib/services/figma-integration.service')
jest.mock('@/lib/auth')

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://lumo.test'
})
beforeEach(() => {
  jest.resetAllMocks()
  ;(auth.requireAuth as jest.Mock).mockResolvedValue({ userId: 'clerk_1' })
  ;(auth.getUserWorkspace as jest.Mock).mockResolvedValue({
    workspaceId: 'w1',
    member: { id: 'm1' },
    workspace: { slug: 'lumo' },
  })
})

function makeReq(query: Record<string, string>): NextRequest {
  const url = new URL('https://lumo.test/api/figma/callback')
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return new NextRequest(url)
}

describe('GET /api/figma/callback', () => {
  it('redirects with generic error when state is missing', async () => {
    const res = await GET(makeReq({ code: 'c' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('figma_error=1')
  })

  it('redirects with invalid_state on tampered state', async () => {
    ;(svc.decodeOauthState as jest.Mock).mockReturnValue(null)
    const res = await GET(makeReq({ code: 'c', state: 'tampered' }))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('figma_error=invalid_state')
  })

  it('returns 401 when caller is not authenticated', async () => {
    ;(svc.decodeOauthState as jest.Mock).mockReturnValue({
      workspaceId: 'w1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
    ;(auth.requireAuth as jest.Mock).mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )

    const res = await GET(makeReq({ code: 'c', state: 'good' }))

    expect(res.status).toBe(401)
    expect(svc.completeOauthFlow).not.toHaveBeenCalled()
  })

  it('redirects with identity_mismatch when authed user is not the state member', async () => {
    ;(svc.decodeOauthState as jest.Mock).mockReturnValue({
      workspaceId: 'w1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
    ;(auth.getUserWorkspace as jest.Mock).mockResolvedValue({
      workspaceId: 'w1',
      member: { id: 'm_other' }, // different member
      workspace: { slug: 'lumo' },
    })

    const res = await GET(makeReq({ code: 'c', state: 'good' }))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain(
      'figma_error=identity_mismatch'
    )
    expect(svc.completeOauthFlow).not.toHaveBeenCalled()
  })

  it('completes flow and redirects on success', async () => {
    ;(svc.decodeOauthState as jest.Mock).mockReturnValue({
      workspaceId: 'w1',
      memberId: 'm1',
      workspaceUrl: 'lumo',
    })
    ;(svc.completeOauthFlow as jest.Mock).mockResolvedValue(undefined)

    const res = await GET(makeReq({ code: 'c', state: 'good' }))

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain(
      '/workspace/lumo/settings/integrations?connected=1'
    )
    expect(svc.completeOauthFlow).toHaveBeenCalledWith(
      { workspaceId: 'w1', memberId: 'm1', code: 'c' },
      expect.objectContaining({
        actor: { type: 'MEMBER', clerkId: 'clerk_1', memberId: 'm1' },
        source: 'WEB',
      })
    )
  })
})
