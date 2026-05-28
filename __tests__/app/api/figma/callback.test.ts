/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/figma/callback/route'
import * as svc from '@/lib/services/figma-integration.service'

jest.mock('@/lib/services/figma-integration.service')

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://lumo.test'
})
beforeEach(() => jest.resetAllMocks())

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
      '/workspace/lumo/settings/integrations/figma?connected=1'
    )
    expect(svc.completeOauthFlow).toHaveBeenCalledWith({
      workspaceId: 'w1',
      memberId: 'm1',
      code: 'c',
    })
  })
})
