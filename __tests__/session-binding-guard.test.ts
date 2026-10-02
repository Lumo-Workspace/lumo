import { classifyBinding } from '@/lib/services/session-binding-guard'
import { sessionRepository } from '@/lib/repositories/session.repository'

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

const boundTo = (
  id: string,
  identifier = 'LUM-1',
  number = 1,
  title = 'T'
) => ({
  id: 'sess',
  task: { id, title, number, team: { identifier } },
})

beforeEach(() => jest.clearAllMocks())

describe('classifyBinding', () => {
  it('classifies a subagent that is STEWARD by its own binding as steward, not its unbound parent', async () => {
    findBinding.mockImplementation(async (id: string) =>
      id === 'p:a1'
        ? {
            id,
            task: null,
            role: 'STEWARD',
            milestone: { id: 'ms1', name: 'M' },
          }
        : { id, task: null }
    )
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: 'p:a1',
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({
      kind: 'steward',
      milestoneId: 'ms1',
      milestoneName: 'M',
    })
  })
  it('skips the clerk (human web) path without any repo call — RED LINE', async () => {
    const r = await classifyBinding({
      source: 'clerk',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({ kind: 'ok' })
    expect(findBinding).not.toHaveBeenCalled()
  })
  it('returns unconfirmed (no repo call) when the session header is absent', async () => {
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: null,
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({ kind: 'unconfirmed' })
    expect(findBinding).not.toHaveBeenCalled()
  })
  it('returns unconfirmed when the session row cannot be resolved', async () => {
    findBinding.mockResolvedValue(null)
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({ kind: 'unconfirmed' })
  })
  it('returns unbound when the session resolves but has no task binding', async () => {
    findBinding.mockResolvedValue({ id: 'sess', task: null })
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({ kind: 'unbound' })
  })
  it('returns ok when the session is bound to the target task', async () => {
    findBinding.mockResolvedValue(boundTo('t1'))
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({ kind: 'ok' })
  })
  it('returns mismatch with the bound identifier/title when bound elsewhere', async () => {
    findBinding.mockResolvedValue(boundTo('t2', 'LUM', 487, 'Other task'))
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({
      kind: 'mismatch',
      boundIdentifier: 'LUM-487',
      boundTitle: 'Other task',
    })
  })
})

import { recordUnboundCrossing } from '@/lib/services/session-binding-guard'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'

const coalesce = boundaryCrossingRepository.coalesceRecurrence as jest.Mock
const createCrossing = boundaryCrossingRepository.create as jest.Mock
const createActivity = activityRepository.create as jest.Mock

describe('recordUnboundCrossing', () => {
  it('coalesces into an existing open crossing without creating a new row', async () => {
    coalesce.mockResolvedValue(1)
    await recordUnboundCrossing({
      taskId: 't1',
      action: 'machine verification',
    })
    expect(createCrossing).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })
  it('creates a MEDIUM, reversible crossing + timeline marker on first occurrence', async () => {
    coalesce.mockResolvedValue(0)
    createCrossing.mockResolvedValue({ id: 'bc1' })
    await recordUnboundCrossing({ taskId: 't1', action: 'status change' })
    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        category: 'SESSION_BINDING_MISSING',
        target: 't1',
        severity: 'MEDIUM',
        reversible: true,
        detail: expect.stringContaining('status change'),
      })
    )
    expect(createActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        actorId: null,
        type: 'BOUNDARY_CROSSING_DETECTED',
        payload: expect.objectContaining({
          boundaryCrossingId: 'bc1',
          category: 'SESSION_BINDING_MISSING',
          severity: 'MEDIUM',
        }),
      })
    )
  })
  it('never throws — swallows repository errors (observe-only)', async () => {
    coalesce.mockRejectedValue(new Error('db down'))
    await expect(
      recordUnboundCrossing({ taskId: 't1', action: 'machine verification' })
    ).resolves.toBeUndefined()
  })
})

import { enforceSessionBinding } from '@/lib/services/session-binding-guard'

describe('enforceSessionBinding', () => {
  it('throws 409 with the bound identifier on a mismatch', async () => {
    findBinding.mockResolvedValue(boundTo('t2', 'LUM', 487, 'Other'))
    await expect(
      enforceSessionBinding({
        source: 'bearer',
        sessionId: 'sess',
        memberId: 'm1',
        targetTaskId: 't1',
        action: 'machine verification',
        stewardPolicy: 'forbid-implementation',
      })
    ).rejects.toMatchObject({ status: 409, boundTaskIdentifier: 'LUM-487' })
    expect(createCrossing).not.toHaveBeenCalled()
  })
  it('records a crossing and returns the unbound advisory', async () => {
    findBinding.mockResolvedValue({ id: 'sess', task: null })
    coalesce.mockResolvedValue(0)
    createCrossing.mockResolvedValue({ id: 'bc1' })
    const r = await enforceSessionBinding({
      source: 'bearer',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
      action: 'machine verification',
      stewardPolicy: 'forbid-implementation',
    })
    expect(r).toEqual({ advisory: 'unbound', steward: null })
    expect(createCrossing).toHaveBeenCalled()
  })
  it('returns the unconfirmed advisory without recording when it cannot prove unbound', async () => {
    findBinding.mockResolvedValue(null)
    const r = await enforceSessionBinding({
      source: 'bearer',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
      action: 'status change',
      stewardPolicy: 'allow-governance',
    })
    expect(r).toEqual({ advisory: 'unconfirmed', steward: null })
    expect(createCrossing).not.toHaveBeenCalled()
  })
  it('returns no advisory when bound correctly, and never records', async () => {
    findBinding.mockResolvedValue(boundTo('t1'))
    const r = await enforceSessionBinding({
      source: 'bearer',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
      action: 'machine verification',
      stewardPolicy: 'forbid-implementation',
    })
    expect(r).toEqual({ advisory: null, steward: null })
    expect(createCrossing).not.toHaveBeenCalled()
  })
  it('returns no advisory for the clerk path (RED LINE — never records/throws)', async () => {
    const r = await enforceSessionBinding({
      source: 'clerk',
      sessionId: 'sess',
      memberId: 'm1',
      targetTaskId: 't1',
      action: 'status change',
      stewardPolicy: 'allow-governance',
    })
    expect(r).toEqual({ advisory: null, steward: null })
    expect(createCrossing).not.toHaveBeenCalled()
  })
})

describe('LUM-932 subagent (child session id) binding falls back to the parent', () => {
  const PARENT = 'parent-sess'
  const CHILD = 'parent-sess:agent1'
  const rows = (map: Record<string, unknown>) =>
    findBinding.mockImplementation(async (id: string) => map[id] ?? null)

  it('classifies an unbound child of a STEWARD parent as steward', async () => {
    rows({
      [CHILD]: {
        id: CHILD,
        role: 'IMPLEMENTATION',
        milestone: null,
        task: null,
      },
      [PARENT]: {
        id: PARENT,
        role: 'STEWARD',
        milestone: { id: 'ms1', name: 'M1' },
        task: null,
      },
    })
    const r = await classifyBinding({
      source: 'bearer',
      sessionId: CHILD,
      memberId: 'm1',
      targetTaskId: 't1',
    })
    expect(r).toEqual({
      kind: 'steward',
      milestoneId: 'ms1',
      milestoneName: 'M1',
    })
    expect(findBinding).toHaveBeenCalledWith(PARENT, 'm1')
  })

  it('refuses an implementation action from a STEWARD parent subagent with 409 and no crossing', async () => {
    rows({
      [CHILD]: {
        id: CHILD,
        role: 'IMPLEMENTATION',
        milestone: null,
        task: null,
      },
      [PARENT]: {
        id: PARENT,
        role: 'STEWARD',
        milestone: { id: 'ms1', name: 'M1' },
        task: null,
      },
    })
    await expect(
      enforceSessionBinding({
        source: 'bearer',
        sessionId: CHILD,
        memberId: 'm1',
        targetTaskId: 't1',
        action: 'machine verification',
        stewardPolicy: 'forbid-implementation',
      })
    ).rejects.toMatchObject({ status: 409, sessionRole: 'STEWARD' })
    expect(createCrossing).not.toHaveBeenCalled()
  })

  it('treats an unbound child of a bound parent as the parent binding (ok / mismatch)', async () => {
    rows({
      [CHILD]: {
        id: CHILD,
        role: 'IMPLEMENTATION',
        milestone: null,
        task: null,
      },
      [PARENT]: {
        ...boundTo('t1', 'LUM', 5, 'Parent task'),
        role: 'IMPLEMENTATION',
        milestone: null,
      },
    })
    expect(
      await classifyBinding({
        source: 'bearer',
        sessionId: CHILD,
        memberId: 'm1',
        targetTaskId: 't1',
      })
    ).toEqual({ kind: 'ok' })
    expect(
      await classifyBinding({
        source: 'bearer',
        sessionId: CHILD,
        memberId: 'm1',
        targetTaskId: 't2',
      })
    ).toEqual({
      kind: 'mismatch',
      boundIdentifier: 'LUM-5',
      boundTitle: 'Parent task',
    })
  })

  it('classifies by the child when the child carries its own task', async () => {
    rows({
      [CHILD]: {
        ...boundTo('t2', 'LUM', 9, 'Child task'),
        role: 'IMPLEMENTATION',
        milestone: null,
      },
      [PARENT]: {
        id: PARENT,
        role: 'IMPLEMENTATION',
        milestone: null,
        task: null,
      },
    })
    expect(
      await classifyBinding({
        source: 'bearer',
        sessionId: CHILD,
        memberId: 'm1',
        targetTaskId: 't2',
      })
    ).toEqual({ kind: 'ok' })
    expect(findBinding).not.toHaveBeenCalledWith(PARENT, 'm1')
  })
})
