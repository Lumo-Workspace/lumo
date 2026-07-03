/**
 * @jest-environment node
 *
 * LUM-643: PATCH /api/milestones/[id] close-gate override plumbing. The
 * `?force=1` override is honored ONLY on the human (Clerk) path — a
 * bearer/agent force is a silent no-op (mirrors the task-level DONE gate).
 * The optional body `overrideNote` rides into the service options and never
 * into the milestone update payload itself.
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: { updateMilestone: jest.fn() },
}))
jest.mock('@/lib/services/milestone-rollup.service', () => ({
  milestoneRollupService: { observeOnRead: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { countTasksByStatus: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone-summary.repository', () => ({
  milestoneSummaryRepository: { findByMilestoneId: jest.fn() },
}))

import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/milestones/[milestoneId]/route'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'

const mockIdentity = requireIdentity as jest.Mock
const mockUpdate = milestoneService.updateMilestone as jest.Mock

const params = { params: Promise.resolve({ milestoneId: 'm-1' }) }

function patchRequest(url: string, body: Record<string, unknown>) {
  return new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockUpdate.mockResolvedValue({ id: 'm-1', status: 'COMPLETED' })
})

describe('PATCH /api/milestones/[id] close-gate override (LUM-643)', () => {
  it('passes the override with note to the service on the Clerk path with force=1', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1', source: 'clerk' })
    const res = await PATCH(
      patchRequest('http://x/api/milestones/m-1?force=1', {
        status: 'COMPLETED',
        overrideNote: 'closing with a known NOT_MET — accepted risk',
      }),
      params
    )
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith(
      'm-1',
      'mem-1',
      { status: 'COMPLETED' },
      {
        overrideCloseGate: true,
        overrideNote: 'closing with a known NOT_MET — accepted risk',
      }
    )
  })

  it('ignores force=1 on the bearer/agent path — no override option reaches the service', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1', source: 'bearer' })
    await PATCH(
      patchRequest('http://x/api/milestones/m-1?force=1', {
        status: 'COMPLETED',
      }),
      params
    )
    expect(mockUpdate).toHaveBeenCalledWith(
      'm-1',
      'mem-1',
      { status: 'COMPLETED' },
      undefined
    )
  })

  it('clerk without force gets no override either, and a service 409 surfaces as 409', async () => {
    mockIdentity.mockResolvedValue({ memberId: 'mem-1', source: 'clerk' })
    mockUpdate.mockRejectedValue(
      Object.assign(
        new Error('Milestone close blocked: 2 exit criteria unresolved'),
        {
          status: 409,
        }
      )
    )
    const res = await PATCH(
      patchRequest('http://x/api/milestones/m-1', { status: 'COMPLETED' }),
      params
    )
    expect(mockUpdate).toHaveBeenCalledWith(
      'm-1',
      'mem-1',
      { status: 'COMPLETED' },
      undefined
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toContain('exit criteria unresolved')
  })
})
