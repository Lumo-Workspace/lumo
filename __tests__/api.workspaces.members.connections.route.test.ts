/**
 * @jest-environment node
 *
 * LUM-1136 — GET /api/workspaces/members/connections: any member of the
 * workspace reads every member's connections.
 */
jest.mock('@/lib/auth', () => ({ requireIdentity: jest.fn() }))
jest.mock('@/lib/services/member-connection.service', () => ({
  memberConnectionService: { listConnections: jest.fn() },
}))
import { NextResponse, type NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { memberConnectionService } from '@/lib/services/member-connection.service'
import { GET } from '@/app/api/workspaces/members/connections/route'

const mockId = requireIdentity as jest.Mock
const mockList = memberConnectionService.listConnections as jest.Mock
const req = () =>
  new Request(
    'http://localhost/api/workspaces/members/connections'
  ) as unknown as NextRequest

beforeEach(() => jest.clearAllMocks())

describe('GET /api/workspaces/members/connections', () => {
  it("returns the caller's workspace connections", async () => {
    mockId.mockResolvedValueOnce({ workspaceId: 'w1' })
    const view = {
      connections: { m1: [{ agent: 'CODEX' }] },
      latestCliVersion: '1.122.0',
    }
    mockList.mockResolvedValueOnce(view)
    const res = await GET(req())
    expect(mockList).toHaveBeenCalledWith('w1', expect.any(Date))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(view)
  })

  it('passes an auth failure through untouched', async () => {
    const denied = NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    mockId.mockResolvedValueOnce(denied)
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(mockList).not.toHaveBeenCalled()
  })

  it('500s when the service throws', async () => {
    mockId.mockResolvedValueOnce({ workspaceId: 'w1' })
    mockList.mockRejectedValueOnce(new Error('db down'))
    const res = await GET(req())
    expect(res.status).toBe(500)
  })
})
