import { enforceSessionBinding } from '@/lib/services/session-binding-guard'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { extractAttributionSignals } from '@/lib/attribution/signals'

jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: { findForMemberWithBinding: jest.fn() },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    coalesceRecurrence: jest.fn(),
    create: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))

const findBinding = sessionRepository.findForMemberWithBinding as jest.Mock
const base = {
  source: 'bearer' as const,
  sessionId: 'sess',
  memberId: 'm1',
  targetTaskId: 't1',
  action: 'machine verification',
}

beforeEach(() => jest.clearAllMocks())

function expectNothingRecorded() {
  expect(boundaryCrossingRepository.create).not.toHaveBeenCalled()
  expect(boundaryCrossingRepository.coalesceRecurrence).not.toHaveBeenCalled()
  expect(activityRepository.create).not.toHaveBeenCalled()
}

describe('unbound task work is inferred instead of flagged', () => {
  it('writes no crossing and returns no advisory for an unbound session', async () => {
    findBinding.mockResolvedValue({ id: 'sess', task: null })
    const r = await enforceSessionBinding({
      ...base,
      stewardPolicy: 'forbid-implementation',
    })
    expect(r).toEqual({ advisory: null, steward: null })
    expectNothingRecorded()
  })

  it('still throws 409 when explicitly bound to another task', async () => {
    findBinding.mockResolvedValue({
      id: 'sess',
      task: {
        id: 't2',
        title: 'Other',
        number: 7,
        team: { identifier: 'LUM' },
      },
    })
    await expect(
      enforceSessionBinding({ ...base, stewardPolicy: 'forbid-implementation' })
    ).rejects.toMatchObject({ status: 409, boundTaskIdentifier: 'LUM-7' })
    expectNothingRecorded()
  })

  it('still refuses implementation actions from a steward session', async () => {
    findBinding.mockResolvedValue({
      id: 'sess',
      role: 'STEWARD',
      milestone: { id: 'ms1', name: 'M1' },
      task: null,
    })
    await expect(
      enforceSessionBinding({ ...base, stewardPolicy: 'forbid-implementation' })
    ).rejects.toMatchObject({ status: 409, sessionRole: 'STEWARD' })
    expectNothingRecorded()
  })

  it('keeps the unconfirmed advisory when the session cannot be resolved', async () => {
    findBinding.mockResolvedValue(null)
    const r = await enforceSessionBinding({
      ...base,
      stewardPolicy: 'allow-governance',
    })
    expect(r).toEqual({ advisory: 'unconfirmed', steward: null })
    expectNothingRecorded()
  })

  it('treats the lumo verify call itself as an identification signal', () => {
    const signals = extractAttributionSignals('PRE_TOOL_USE', {
      tool_name: 'Bash',
      tool_input: { command: 'lumo verify LUM-12' },
    })
    expect(signals).toContainEqual({ kind: 'LUMO_CMD', identifier: 'LUM-12' })
  })
})
