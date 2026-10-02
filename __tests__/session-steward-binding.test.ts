/**
 * @jest-environment node
 *
 * LUM-640: steward (governance) session binding — the milestone form of the
 * LUM-459 lifetime lock. Pins:
 *   - steward → attach any task: 409
 *   - task-bound → attach --steward: 409
 *   - steward → attach a DIFFERENT milestone: 409
 *   - same milestone re-attach: idempotent
 *   - multiple steward sessions may coexist on one milestone
 *   - IMPLEMENTATION sessions bind tasks exactly as before (regression)
 */
// LUM-807: the next-step rules ask whether the task has a script and a PR.
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { listIdAndNumberByTask: jest.fn(async () => []) },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: { hasForTask: jest.fn(async () => false) },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    upsertWithTaskId: jest.fn(),
    inheritTaskToUnboundChildren: jest.fn(),
    upsertWithMilestoneId: jest.fn(),
    findForMemberWithBinding: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    bulkSetTaskIdForNullEventsInSession: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findMemberIdForHook: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/milestone.repository', () => ({
  milestoneRepository: {
    findById: jest.fn(),
    findByWorkspace: jest.fn(),
  },
}))
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {
    buildMemorySectionForTask: jest.fn(),
    buildCriteriaSectionForTask: jest.fn(),
    // LUM-807: the attach payload carries the test-case nudge beside the contract.
    buildTestCaseSectionForTask: jest.fn(),
    buildPreviousSessionRecoveryForTask: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: {
    buildBlockerWarningSectionForTask: jest.fn(),
  },
}))
// LUM-647: steward bind injects prior-milestone memory via this service (dynamic
// import). Mock it to an empty section so the binding assertions stay focused on
// the lock semantics (the injection has its own suite).
jest.mock('@/lib/services/steward-context.service', () => ({
  stewardContextService: {
    buildMilestoneMemorySection: jest
      .fn()
      .mockResolvedValue({ section: '', count: 0 }),
  },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { taskService } from '@/lib/services/task.service'
import { taskContextService } from '@/lib/services/task-context.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import { sessionService } from '@/lib/services/session.service'

const sessRepo = sessionRepository as jest.Mocked<typeof sessionRepository>
const hookRepo = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const misc = miscRepository as jest.Mocked<typeof miscRepository>
const milestones = milestoneRepository as jest.Mocked<
  typeof milestoneRepository
>
const tasks = taskService as jest.Mocked<typeof taskService>
const ctx = taskContextService as jest.Mocked<typeof taskContextService>
const deps = taskDependencyService as jest.Mocked<typeof taskDependencyService>

const identity = {
  user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
} as never

const MILESTONE = {
  id: 'ms_1',
  name: 'Agent-Native Milestones',
  slug: 'agent-native-milestones',
}
const OTHER_MILESTONE = {
  id: 'ms_2',
  name: 'Fidelity',
  slug: 'fidelity',
}

/** A session row already steward-bound to MILESTONE. */
const stewardRow = {
  id: 'sess_1',
  startedAt: new Date(),
  lastActivityAt: new Date(),
  eventCount: 3,
  role: 'STEWARD' as const,
  milestone: { id: MILESTONE.id, name: MILESTONE.name },
  task: null,
}

/** A session row already task-bound (classic IMPLEMENTATION form). */
const taskBoundRow = {
  id: 'sess_1',
  startedAt: new Date(),
  lastActivityAt: new Date(),
  eventCount: 3,
  role: 'IMPLEMENTATION' as const,
  milestone: null,
  task: {
    id: 'task_1',
    number: 42,
    title: 'Some task',
    status: 'IN_PROGRESS',
    team: { identifier: 'LUM' },
  },
}

beforeEach(() => {
  jest.clearAllMocks()
  sessRepo.inheritTaskToUnboundChildren.mockResolvedValue({
    childCount: 0,
    retaggedEventCount: 0,
  })
  misc.findMemberIdForHook.mockResolvedValue('wm_1')
  tasks.resolveIdentifier.mockResolvedValue({
    id: 'task_2',
    identifier: 'LUM-43',
    title: 'Another task',
  } as never)
  milestones.findById.mockResolvedValue(null)
  milestones.findByWorkspace.mockResolvedValue([
    MILESTONE,
    OTHER_MILESTONE,
  ] as never)
  sessRepo.findForMemberWithBinding.mockResolvedValue(null)
  sessRepo.upsertWithMilestoneId.mockResolvedValue({
    ownedByOther: false,
    session: { id: 'sess_1', milestoneId: MILESTONE.id },
  })
  sessRepo.upsertWithTaskId.mockResolvedValue({
    ownedByOther: false,
    session: { id: 'sess_1', taskId: 'task_2' },
  })
  hookRepo.bulkSetTaskIdForNullEventsInSession.mockResolvedValue({
    count: 0,
  } as never)
  ctx.buildMemorySectionForTask.mockResolvedValue('')
  ctx.buildCriteriaSectionForTask.mockResolvedValue('')
  ctx.buildTestCaseSectionForTask.mockResolvedValue('')
  ctx.buildPreviousSessionRecoveryForTask.mockResolvedValue(null)
  deps.buildBlockerWarningSectionForTask.mockResolvedValue('')
})

describe('steward binding is a lifetime milestone lock', () => {
  it('binds an unbound session to a milestone as STEWARD (by name)', async () => {
    const result = await sessionService.bindSessionToMilestone({
      identity,
      sessionId: 'sess_1',
      milestoneRef: 'agent-native milestones', // name match, case-insensitive
    })
    expect(result).toEqual({
      status: 'bound',
      role: 'STEWARD',
      milestoneId: MILESTONE.id,
      milestoneName: MILESTONE.name,
      stewardMemorySection: '',
    })
    expect(sessRepo.upsertWithMilestoneId).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sess_1',
        workspaceId: 'ws_1',
        workspaceMemberId: 'wm_1',
        milestoneId: MILESTONE.id,
      })
    )
  })

  it('steward-bound session: attaching ANY task is refused with 409', async () => {
    sessRepo.findForMemberWithBinding.mockResolvedValue(stewardRow as never)
    await expect(
      sessionService.bindSessionToTask({
        identity,
        sessionId: 'sess_1',
        taskIdentifier: 'LUM-43',
      })
    ).rejects.toMatchObject({
      status: 409,
      currentMilestoneId: MILESTONE.id,
      currentMilestoneName: MILESTONE.name,
      sessionRole: 'STEWARD',
    })
    expect(sessRepo.upsertWithTaskId).not.toHaveBeenCalled()
  })

  it('task-bound session: attaching a milestone (--steward) is refused with 409', async () => {
    sessRepo.findForMemberWithBinding.mockResolvedValue(taskBoundRow as never)
    await expect(
      sessionService.bindSessionToMilestone({
        identity,
        sessionId: 'sess_1',
        milestoneRef: MILESTONE.name,
      })
    ).rejects.toMatchObject({
      status: 409,
      currentTaskIdentifier: 'LUM-42',
      currentTaskTitle: 'Some task',
    })
    expect(sessRepo.upsertWithMilestoneId).not.toHaveBeenCalled()
  })

  it('steward-bound session: attaching a DIFFERENT milestone is refused with 409', async () => {
    sessRepo.findForMemberWithBinding.mockResolvedValue(stewardRow as never)
    await expect(
      sessionService.bindSessionToMilestone({
        identity,
        sessionId: 'sess_1',
        milestoneRef: OTHER_MILESTONE.name,
      })
    ).rejects.toMatchObject({
      status: 409,
      currentMilestoneId: MILESTONE.id,
      currentMilestoneName: MILESTONE.name,
    })
    expect(sessRepo.upsertWithMilestoneId).not.toHaveBeenCalled()
  })

  it('re-attaching the SAME milestone is idempotent (no 409, upsert runs)', async () => {
    sessRepo.findForMemberWithBinding.mockResolvedValue(stewardRow as never)
    const result = await sessionService.bindSessionToMilestone({
      identity,
      sessionId: 'sess_1',
      milestoneRef: MILESTONE.name,
    })
    expect(result.status).toBe('bound')
    expect(result.milestoneId).toBe(MILESTONE.id)
    expect(sessRepo.upsertWithMilestoneId).toHaveBeenCalled()
  })

  it('multiple steward sessions may coexist on one milestone', async () => {
    // A second, unbound session binds the same milestone — no uniqueness check
    // across sessions, so this succeeds exactly like the first.
    sessRepo.findForMemberWithBinding.mockResolvedValue(null)
    sessRepo.upsertWithMilestoneId.mockResolvedValue({
      ownedByOther: false,
      session: { id: 'sess_2', milestoneId: MILESTONE.id },
    })
    const result = await sessionService.bindSessionToMilestone({
      identity,
      sessionId: 'sess_2',
      milestoneRef: MILESTONE.name,
    })
    expect(result.status).toBe('bound')
    expect(result.milestoneId).toBe(MILESTONE.id)
  })

  it('an ambiguous milestone reference is refused with 400 and the candidates', async () => {
    milestones.findByWorkspace.mockResolvedValue([
      { id: 'ms_a', name: 'Same Name', slug: 'same-1' },
      { id: 'ms_b', name: 'Same Name', slug: 'same-2' },
    ] as never)
    await expect(
      sessionService.bindSessionToMilestone({
        identity,
        sessionId: 'sess_1',
        milestoneRef: 'Same Name',
      })
    ).rejects.toMatchObject({ status: 400 })
  })

  it('an unknown milestone reference is refused with 404', async () => {
    await expect(
      sessionService.bindSessionToMilestone({
        identity,
        sessionId: 'sess_1',
        milestoneRef: 'no-such-milestone',
      })
    ).rejects.toMatchObject({ status: 404 })
  })

  it('REGRESSION: an IMPLEMENTATION session binds a task exactly as before', async () => {
    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 'sess_1',
      taskIdentifier: 'LUM-43',
    })
    expect(result.status).toBe('bound')
    expect(result.taskId).toBe('task_2')
    expect(sessRepo.upsertWithTaskId).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'sess_1', taskId: 'task_2' })
    )
  })

  it('REGRESSION: a task-bound session re-attaching a DIFFERENT task still 409s', async () => {
    sessRepo.findForMemberWithBinding.mockResolvedValue(taskBoundRow as never)
    await expect(
      sessionService.bindSessionToTask({
        identity,
        sessionId: 'sess_1',
        taskIdentifier: 'LUM-43',
      })
    ).rejects.toMatchObject({
      status: 409,
      currentTaskIdentifier: 'LUM-42',
    })
  })
})
