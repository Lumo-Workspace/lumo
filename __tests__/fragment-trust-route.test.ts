/**
 * @jest-environment node
 */
import { NextResponse } from 'next/server'
import { POST } from '@/app/api/lineage/fragment-trust/route'
import { requireIdentity } from '@/lib/auth/identity'
import { lineageService } from '@/lib/services/lineage.service'

jest.mock('@/lib/auth/identity')
jest.mock('@/lib/services/lineage.service')

const auth = requireIdentity as jest.MockedFunction<typeof requireIdentity>
const svc = lineageService as jest.Mocked<typeof lineageService>

function req(body: unknown): Request {
  return new Request('http://t/api/lineage/fragment-trust', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/lineage/fragment-trust', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    auth.mockResolvedValue({ memberId: 'm', workspaceId: 'w' } as never)
  })

  it('returns the service trust map', async () => {
    svc.fragmentTrustForMemories.mockResolvedValue({
      a: { kind: 'usage', resolvedTasks: 4, mergedTasks: 3, pct: 75 },
    })
    const res = await POST(req({ ids: ['a'] }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      trust: {
        a: { kind: 'usage', resolvedTasks: 4, mergedTasks: 3, pct: 75 },
      },
    })
  })

  it('400s on an invalid body', async () => {
    const res = await POST(req({ ids: 'not-an-array' }))
    expect(res.status).toBe(400)
    expect(svc.fragmentTrustForMemories).not.toHaveBeenCalled()
  })

  it('returns 401 when identity fails', async () => {
    auth.mockResolvedValue(
      NextResponse.json({ error: 'x' }, { status: 401 }) as never
    )
    const res = await POST(req({ ids: ['a'] }))
    expect(res.status).toBe(401)
    expect(svc.fragmentTrustForMemories).not.toHaveBeenCalled()
  })
})
