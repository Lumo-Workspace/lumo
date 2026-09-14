/**
 * @jest-environment node
 */
jest.mock('@/lib/auth', () => ({
  requireIdentity: jest.fn(),
}))
jest.mock('@/lib/services/milestone.service', () => ({
  milestoneService: {
    updateMilestone: jest.fn(),
  },
}))
// The route module also imports these (for GET) — mock them so loading the
// route in jest never pulls the real prisma client.
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: { countTasksByStatus: jest.fn() },
}))
jest.mock('@/lib/repositories/milestone-summary.repository', () => ({
  milestoneSummaryRepository: { findByMilestoneId: jest.fn() },
}))
jest.mock('@/lib/services/milestone-rollup.service', () => ({
  milestoneRollupService: { observeOnRead: jest.fn() },
}))

import { PATCH } from '@/app/api/milestones/[milestoneId]/route'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'

const mockIdentity = requireIdentity as jest.Mock
const mockUpdate = milestoneService.updateMilestone as jest.Mock

const params = { params: Promise.resolve({ milestoneId: 'm-1' }) }

function patchReq(body: unknown): Request {
  return new Request('http://x/api/milestones/m-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockIdentity.mockReset()
  mockIdentity.mockResolvedValue({ memberId: 'mem-1' })
  mockUpdate.mockReset()
})

describe('tokenBudget patch', () => {
  it('sets an advisory token budget and returns the updated milestone', async () => {
    mockUpdate.mockResolvedValue({
      id: 'm-1',
      name: 'Q3',
      tokenBudget: 5000000,
    })
    const res = await PATCH(patchReq({ tokenBudget: 5000000 }) as never, params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.milestone.tokenBudget).toBe(5000000)
    // LUM-714: PATCH is metadata-only — the close-gate override moved to its
    // own endpoint, so there is no fourth argument to pass any more.
    expect(mockUpdate).toHaveBeenCalledWith('m-1', 'mem-1', {
      tokenBudget: 5000000,
    })
  })

  it('clears the budget with null', async () => {
    mockUpdate.mockResolvedValue({ id: 'm-1', name: 'Q3', tokenBudget: null })
    const res = await PATCH(patchReq({ tokenBudget: null }) as never, params)
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith('m-1', 'mem-1', {
      tokenBudget: null,
    })
  })

  it('rejects non-positive, non-integer and out-of-range values with 400', async () => {
    for (const bad of [0, -5, 1.5, 2_147_483_648, 'lots']) {
      const res = await PATCH(patchReq({ tokenBudget: bad }) as never, params)
      expect(res.status).toBe(400)
    }
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('leaves the budget untouched when the field is absent', async () => {
    mockUpdate.mockResolvedValue({ id: 'm-1', name: 'Renamed' })
    const res = await PATCH(patchReq({ name: 'Renamed' }) as never, params)
    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith('m-1', 'mem-1', { name: 'Renamed' })
  })
})
