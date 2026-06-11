import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findById: jest.fn(), acknowledge: jest.fn() },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorByMemberId: jest.fn() },
}))

const findById = boundaryCrossingRepository.findById as jest.Mock
const ack = boundaryCrossingRepository.acknowledge as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const findActor = memberRepository.findActorByMemberId as jest.Mock

const ATTRIB = { actorMemberId: 'member-1', actorClerkId: 'clerk-1' }

beforeEach(() => {
  jest.clearAllMocks()
  findActor.mockResolvedValue({ id: 'actor-1' })
  ack.mockResolvedValue({ count: 1 })
  createActivity.mockResolvedValue({ id: 'act-1' })
})

describe('boundaryCrossingService.acknowledge', () => {
  it('marks an open crossing acknowledged and writes a timeline marker attributed to the human', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'PUSH_TO_PROTECTED_BRANCH',
      detail: 'git push origin main',
      acknowledgedAt: null,
    })
    const out = await boundaryCrossingService.acknowledge('t-1', 'bc-1', ATTRIB)
    expect(out).toEqual({ crossingId: 'bc-1', acknowledged: true })
    expect(ack).toHaveBeenCalledWith('bc-1', 'actor-1', expect.any(Date))
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        actorId: 'actor-1',
        type: 'BOUNDARY_CROSSING_ACKNOWLEDGED',
      })
    )
  })

  it('404s when the crossing is not on the task (no cross-task acknowledgement)', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 'other',
      acknowledgedAt: null,
    })
    await expect(
      boundaryCrossingService.acknowledge('t-1', 'bc-1', ATTRIB)
    ).rejects.toMatchObject({ status: 404 })
    expect(ack).not.toHaveBeenCalled()
  })

  it('404s when the crossing does not exist', async () => {
    findById.mockResolvedValue(null)
    await expect(
      boundaryCrossingService.acknowledge('t-1', 'bc-1', ATTRIB)
    ).rejects.toMatchObject({ status: 404 })
  })

  it('is idempotent: re-acknowledging an already-cleared crossing writes no second marker', async () => {
    findById.mockResolvedValue({
      id: 'bc-1',
      taskId: 't-1',
      category: 'PUSH_TO_PROTECTED_BRANCH',
      detail: 'git push origin main',
      acknowledgedAt: new Date('2026-01-01'),
    })
    const out = await boundaryCrossingService.acknowledge('t-1', 'bc-1', ATTRIB)
    expect(out).toEqual({ crossingId: 'bc-1', acknowledged: true })
    expect(ack).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })
})
