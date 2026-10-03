/**
 * @jest-environment node
 *
 * LUM-640: the first gate layer — steward sessions are refused implementation
 * actions at the service boundary, while governance actions pass through with
 * session attribution. The session-binding guard runs REAL here (only its
 * repositories are mocked), so these tests pin the actual classification +
 * enforcement chain, not a stub.
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findForMemberWithBinding: jest.fn(),
    findWorkspaceId: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: jest.fn(),
    coalesceRecurrence: jest.fn().mockResolvedValue(0),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(),
    getTaskDetail: jest.fn(),
    updateTaskWithSideEffects: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: {
    findByWorkspaceAndClerkId: jest.fn(),
    findActorByMemberId: jest.fn(),
    findAllWithProfilesForCli: jest.fn(),
  },
}))
import { sessionRepository } from '@/lib/repositories/session.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { taskService } from '@/lib/services/task.service'
import { memberRepository } from '@/lib/repositories/member.repository'
import { taskCliService } from '@/lib/services/task-cli.service'
import { enforceSessionBinding } from '@/lib/services/session-binding-guard'

const mockBinding = sessionRepository.findForMemberWithBinding as jest.Mock
const mockFindSessionWs = sessionRepository.findWorkspaceId as jest.Mock
const mockCrossingCreate = boundaryCrossingRepository.create as jest.Mock
const mockResolveIdentifier = taskService.resolveIdentifier as jest.Mock
const mockGetDetail = taskService.getTaskDetail as jest.Mock
const mockUpdate = taskService.updateTaskWithSideEffects as jest.Mock
const mockFindMember = memberRepository.findByWorkspaceAndClerkId as jest.Mock
const mockFindActor = memberRepository.findActorByMemberId as jest.Mock

const STEWARD_ROW = {
  id: 'sess_steward',
  startedAt: new Date(),
  lastActivityAt: new Date(),
  eventCount: 5,
  role: 'STEWARD',
  milestone: { id: 'ms_1', name: 'Agent-Native Milestones' },
  task: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  mockBinding.mockResolvedValue(STEWARD_ROW)
  mockFindSessionWs.mockResolvedValue({ workspaceId: 'ws_1' })
  mockResolveIdentifier.mockResolvedValue({
    id: 'task_1',
    identifier: 'LUM-42',
    title: 'T',
    status: 'TODO',
  })
  mockGetDetail.mockResolvedValue({
    id: 'task_1',
    status: 'TODO',
    project: { workspaceId: 'ws_1' },
    assignee: null,
  })
  mockFindMember.mockResolvedValue({ id: 'wm_1' })
  mockFindActor.mockResolvedValue({ id: 'actor_steward' })
  mockUpdate.mockResolvedValue({
    task: {
      id: 'task_1',
      title: 'T',
      teamIdentifier: 'LUM',
      number: 42,
      tags: [],
    },
  })
})

describe('steward session is gated from implementation actions', () => {
  it('the guard itself rejects forbid-implementation with the milestone named', async () => {
    await expect(
      enforceSessionBinding({
        source: 'bearer',
        sessionId: 'sess_steward',
        memberId: 'wm_1',
        targetTaskId: 'task_1',
        action: 'status change',
        stewardPolicy: 'forbid-implementation',
      })
    ).rejects.toMatchObject({
      status: 409,
      sessionRole: 'STEWARD',
      stewardMilestoneId: 'ms_1',
      stewardMilestoneName: 'Agent-Native Milestones',
    })
  })

  it('steward moving a task to in_progress assigned to ITSELF is refused 409', async () => {
    // The task is currently assigned to the steward's own actor.
    mockGetDetail.mockResolvedValue({
      id: 'task_1',
      status: 'TODO',
      project: { workspaceId: 'ws_1' },
      assignee: { id: 'actor_steward', type: 'HUMAN' },
    })
    await expect(
      taskCliService.updateFromCli({
        workspaceId: 'ws_1',
        workspaceSlug: 'ws',
        callerClerkId: 'clerk_1',
        identifier: 'LUM-42',
        sourceSessionId: 'sess_steward',
        input: { status: 'IN_PROGRESS' },
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('steward assigning ITSELF while moving to in_progress is refused 409 (incoming assignee)', async () => {
    await expect(
      taskCliService.updateFromCli({
        workspaceId: 'ws_1',
        workspaceSlug: 'ws',
        callerClerkId: 'clerk_1',
        identifier: 'LUM-42',
        sourceSessionId: 'sess_steward',
        input: { status: 'IN_PROGRESS', assigneeRef: 'me' },
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('steward governance actions pass through with attribution', () => {
  it('the guard passes a steward through on allow-governance with no crossing', async () => {
    const result = await enforceSessionBinding({
      source: 'bearer',
      sessionId: 'sess_steward',
      memberId: 'wm_1',
      targetTaskId: 'task_1',
      action: 'status change',
      stewardPolicy: 'allow-governance',
    })
    expect(result).toEqual({
      advisory: null,
      steward: {
        milestoneId: 'ms_1',
        milestoneName: 'Agent-Native Milestones',
      },
    })
    expect(mockCrossingCreate).not.toHaveBeenCalled()
  })

  it('steward task update (status change dispatched to ANOTHER assignee) proceeds', async () => {
    mockGetDetail.mockResolvedValue({
      id: 'task_1',
      status: 'TODO',
      project: { workspaceId: 'ws_1' },
      assignee: { id: 'actor_other', type: 'HUMAN' },
    })
    const result = await taskCliService.updateFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      callerClerkId: 'clerk_1',
      identifier: 'LUM-42',
      sourceSessionId: 'sess_steward',
      input: { status: 'IN_PROGRESS' },
    })
    expect(result.identifier).toBe('LUM-42')
    expect(mockUpdate).toHaveBeenCalled()
    // No SESSION_BINDING_MISSING crossing: the steward is legitimately bound.
    expect(mockCrossingCreate).not.toHaveBeenCalled()
  })

  it('steward non-status task update (title) proceeds untouched', async () => {
    const result = await taskCliService.updateFromCli({
      workspaceId: 'ws_1',
      workspaceSlug: 'ws',
      callerClerkId: 'clerk_1',
      identifier: 'LUM-42',
      sourceSessionId: 'sess_steward',
      input: { title: 'Sharper title' },
    })
    expect(result.identifier).toBe('LUM-42')
    expect(mockUpdate).toHaveBeenCalled()
  })
})
