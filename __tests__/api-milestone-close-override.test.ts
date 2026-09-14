/**
 * @jest-environment node
 *
 * LUM-643 close-gate override, rehomed by LUM-714. Completion is derived, so
 * there is no `status: 'COMPLETED'` PATCH to force any more — the override is
 * its own endpoint, `POST /api/milestones/[id]/close-override`.
 *
 * The human-only rule is unchanged and is what these tests pin: a Clerk
 * identity may override; a bearer/agent identity is refused outright (403)
 * rather than silently no-op'd, so an agent can never launder a completion
 * past an unresolved contract.
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: { overrideMilestoneClose: jest.fn() },
}))

import { NextRequest } from 'next/server'
import { POST } from '@/app/api/milestones/[milestoneId]/close-override/route'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'

const mockIdentity = requireIdentity as jest.Mock
const mockOverride = milestoneService.overrideMilestoneClose as jest.Mock

const params = { params: Promise.resolve({ milestoneId: 'm-1' }) }

function postRequest(body: Record<string, unknown>) {
  return new NextRequest('http://x/api/milestones/m-1/close-override', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockOverride.mockResolvedValue({ id: 'm-1', completedAt: new Date() })
})

describe('POST /api/milestones/[id]/close-override (LUM-643/LUM-714)', () => {
  it('passes the note to the service on the Clerk path', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1', source: 'clerk' })
    const res = await POST(
      postRequest({
        overrideNote: 'closing with a known NOT_MET — accepted risk',
      }),
      params
    )
    expect(res.status).toBe(200)
    expect(mockOverride).toHaveBeenCalledWith(
      'm-1',
      'mem-1',
      'closing with a known NOT_MET — accepted risk'
    )
  })

  it('accepts an empty body — the note is optional, recorded as null', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1', source: 'clerk' })
    const res = await POST(postRequest({}), params)
    expect(res.status).toBe(200)
    expect(mockOverride).toHaveBeenCalledWith('m-1', 'mem-1', null)
  })

  it('refuses the bearer/agent path with 403 — the service is never reached', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1', source: 'bearer' })
    const res = await POST(postRequest({ overrideNote: 'let me in' }), params)
    expect(res.status).toBe(403)
    expect(mockOverride).not.toHaveBeenCalled()
  })

  it('surfaces a service 409 (nothing to override) as 409', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1', source: 'clerk' })
    mockOverride.mockRejectedValue(
      Object.assign(
        new Error('Nothing to override: this milestone has no unresolved'),
        { status: 409 }
      )
    )
    const res = await POST(postRequest({}), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('Nothing to override')
  })
})
