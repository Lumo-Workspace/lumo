/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    upsertWithTaskId: jest.fn(),
    inheritTaskToUnboundChildren: jest.fn(),
    findForMemberWithBinding: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    retagSessionEventsToExplicitTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/misc.repository', () => ({
  miscRepository: {
    findMemberIdForHook: jest.fn(),
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
    // LUM-807: attach carries the test-case nudge beside the contract.
    buildTestCaseSectionForTask: jest.fn(async () => ''),
    buildPreviousSessionRecoveryForTask: jest.fn(),
  },
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: {
    buildBlockerWarningSectionForTask: jest.fn(),
  },
}))
jest.mock('@/lib/services/pr-security-reminder.service', () => ({
  prSecurityReminderService: {
    buildSessionStartSection: jest.fn(),
  },
}))

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskService } from '@/lib/services/task.service'
import { taskContextService } from '@/lib/services/task-context.service'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import { prSecurityReminderService } from '@/lib/services/pr-security-reminder.service'
import { sessionService } from '@/lib/services/session.service'

const sessRepo = sessionRepository as jest.Mocked<typeof sessionRepository>
const hookRepo = hookEventRepository as jest.Mocked<typeof hookEventRepository>
const misc = miscRepository as jest.Mocked<typeof miscRepository>
const task = taskService as jest.Mocked<typeof taskService>

const identity = {
  user: { id: 'clerk_1', email: 'a@b.c', name: 'A' },
  workspace: { id: 'ws_1', slug: 'ws', name: 'WS' },
  apiKey: { id: 'key_1', name: 'laptop', prefix: 'lum_abc' },
}

beforeEach(() => {
  jest.clearAllMocks()
  sessRepo.inheritTaskToUnboundChildren.mockResolvedValue({
    childCount: 0,
    retaggedEventCount: 0,
    crossingsMoved: 0,
  })
  misc.findMemberIdForHook.mockResolvedValue('wm_1')
  task.resolveIdentifier.mockResolvedValue({
    id: 'task_1',
    identifier: 'LUM-42',
    title: 'Fix login bug',
    status: 'TODO',
  })
  sessRepo.upsertWithTaskId.mockResolvedValue({
    ownedByOther: false,
    session: { id: 'sess_1', taskId: 'task_1' },
  } as never)
  // Default: session has no current binding → no override conflict.
  sessRepo.findForMemberWithBinding.mockResolvedValue(null as never)
  hookRepo.retagSessionEventsToExplicitTask.mockResolvedValue({
    eventsUpdated: 3,
    crossingsMoved: 0,
  })
  ;(
    taskContextService.buildMemorySectionForTask as jest.Mock
  ).mockResolvedValue('')
  ;(
    taskContextService.buildPreviousSessionRecoveryForTask as jest.Mock
  ).mockResolvedValue(null)
  ;(
    taskDependencyService.buildBlockerWarningSectionForTask as jest.Mock
  ).mockResolvedValue('')
  ;(
    prSecurityReminderService.buildSessionStartSection as jest.Mock
  ).mockResolvedValue('')
})

describe('sessionService.bindSessionToTask', () => {
  it('upserts session to task and retags all its events (provisional tags included) to it', async () => {
    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 'sess_1',
      taskIdentifier: 'LUM-42',
    })

    expect(misc.findMemberIdForHook).toHaveBeenCalledWith('clerk_1', 'ws_1')
    expect(task.resolveIdentifier).toHaveBeenCalledWith('ws_1', 'LUM-42')
    expect(sessRepo.upsertWithTaskId).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'sess_1',
        workspaceId: 'ws_1',
        workspaceMemberId: 'wm_1',
        taskId: 'task_1',
      })
    )
    expect(hookRepo.retagSessionEventsToExplicitTask).toHaveBeenCalledWith(
      'sess_1',
      'task_1'
    )
    expect(result).toEqual({
      status: 'bound',
      taskId: 'task_1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Fix login bug',
      retaggedEventCount: 3,
      memorySection: '',
      // LUM-807: the start-of-work test-case nudge.
      testCaseSection: '',
      previousSession: null,
      blockerWarningSection: '',
      securityFindingsSection: '',
      // LUM-686: surfaced so the route can compute next steps without a
      // second read of the task.
      taskStatus: 'TODO',
    })
  })

  it('propagates the blocker warning from taskDependencyService into the bound result (LUM-172)', async () => {
    ;(
      taskDependencyService.buildBlockerWarningSectionForTask as jest.Mock
    ).mockResolvedValue(
      '## ⚠ Dependency alerts\n- This task is blocked by LUM-7'
    )

    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 'sess_1',
      taskIdentifier: 'LUM-42',
    })

    expect(
      taskDependencyService.buildBlockerWarningSectionForTask
    ).toHaveBeenCalledWith('task_1', 'LUM-42')
    if (result.status !== 'bound') throw new Error('expected bound result')
    expect(result.blockerWarningSection).toBe(
      '## ⚠ Dependency alerts\n- This task is blocked by LUM-7'
    )
  })

  it('propagates the security findings section from prSecurityReminderService into the bound result (LUM-737)', async () => {
    ;(
      prSecurityReminderService.buildSessionStartSection as jest.Mock
    ).mockResolvedValue('SECURITY')

    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 'sess_1',
      taskIdentifier: 'LUM-42',
    })

    expect(
      prSecurityReminderService.buildSessionStartSection
    ).toHaveBeenCalledWith('task_1', 'LUM-42')
    if (result.status !== 'bound') throw new Error('expected bound result')
    expect(result.securityFindingsSection).toBe('SECURITY')
  })

  it('succeeds when no events were retagged (attach-before-any-hook)', async () => {
    hookRepo.retagSessionEventsToExplicitTask.mockResolvedValue({
      eventsUpdated: 0,
      crossingsMoved: 0,
    })
    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 'sess_1',
      taskIdentifier: 'LUM-42',
    })
    if (result.status !== 'bound') throw new Error('expected bound result')
    expect(result.retaggedEventCount).toBe(0)
    // The upsert call is what makes attach-before-any-hook work — the
    // session row is created by attach itself, not by a hook event.
    expect(sessRepo.upsertWithTaskId).toHaveBeenCalled()
  })

  it('throws 403 when user is not a workspace member', async () => {
    misc.findMemberIdForHook.mockResolvedValue(null)
    await expect(
      sessionService.bindSessionToTask({
        identity,
        sessionId: 'sess_1',
        taskIdentifier: 'LUM-42',
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('throws 403 when session belongs to another workspace member', async () => {
    sessRepo.upsertWithTaskId.mockResolvedValue({ ownedByOther: true } as never)
    await expect(
      sessionService.bindSessionToTask({
        identity,
        sessionId: 'sess_1',
        taskIdentifier: 'LUM-42',
      })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('throws 404 when task identifier cannot be resolved', async () => {
    task.resolveIdentifier.mockResolvedValue(null)
    await expect(
      sessionService.bindSessionToTask({
        identity,
        sessionId: 'sess_1',
        taskIdentifier: 'LUM-999',
      })
    ).rejects.toMatchObject({ status: 404 })
    expect(sessRepo.upsertWithTaskId).not.toHaveBeenCalled()
  })

  it('includes previousSession from taskContextService in the result', async () => {
    ;(
      taskContextService.buildPreviousSessionRecoveryForTask as jest.Mock
    ).mockResolvedValue({
      headline: 'prev headline',
      unresolved: ['carry over'],
      durationMs: 60_000,
      lastActivityAt: '2026-06-01T10:00:00.000Z',
    })

    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 'sess_1',
      taskIdentifier: 'LUM-42',
    })

    expect(
      taskContextService.buildPreviousSessionRecoveryForTask
    ).toHaveBeenCalledWith('task_1', 'sess_1')
    if (result.status !== 'bound') throw new Error('expected bound result')
    expect(result.previousSession).toEqual({
      headline: 'prev headline',
      unresolved: ['carry over'],
      durationMs: 60_000,
      lastActivityAt: '2026-06-01T10:00:00.000Z',
    })
  })

  // LUM-266: refuse a silent overwrite of an existing binding.
  const boundToOther = {
    id: 'sess_1',
    startedAt: new Date(),
    lastActivityAt: new Date(),
    eventCount: 0,
    task: {
      id: 'task_99',
      number: 7,
      title: 'Other task',
      team: { identifier: 'LUM' },
    },
  }

  it('binds permanently and refuses a different task with 409', async () => {
    // First bind (unbound session) succeeds and sets the lock.
    const first = await sessionService.bindSessionToTask({
      identity,
      sessionId: 'sess_1',
      taskIdentifier: 'LUM-42',
    })
    expect(first.status).toBe('bound')
    expect(sessRepo.upsertWithTaskId).toHaveBeenCalled()

    // Now the session reads back as bound to a DIFFERENT task (LUM-7/task_99).
    jest.clearAllMocks()
    misc.findMemberIdForHook.mockResolvedValue('wm_1')
    task.resolveIdentifier.mockResolvedValue({
      id: 'task_1',
      identifier: 'LUM-42',
      title: 'Fix login bug',
      status: 'TODO',
    })
    sessRepo.findForMemberWithBinding.mockResolvedValue(boundToOther as never)

    await expect(
      sessionService.bindSessionToTask({
        identity,
        sessionId: 'sess_1',
        taskIdentifier: 'LUM-42',
      })
    ).rejects.toMatchObject({
      status: 409,
      currentTaskIdentifier: 'LUM-7',
      currentTaskTitle: 'Other task',
    })
    expect(sessRepo.upsertWithTaskId).not.toHaveBeenCalled()
    expect(hookRepo.retagSessionEventsToExplicitTask).not.toHaveBeenCalled()
  })

  it('re-attaching the same task is idempotent and re-emits context', async () => {
    sessRepo.findForMemberWithBinding.mockResolvedValue({
      ...boundToOther,
      task: { ...boundToOther.task, id: 'task_1', number: 42 },
    } as never)

    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 'sess_1',
      taskIdentifier: 'LUM-42',
    })

    expect(result.status).toBe('bound')
    expect(sessRepo.upsertWithTaskId).toHaveBeenCalled()
    expect(hookRepo.retagSessionEventsToExplicitTask).toHaveBeenCalled()
  })
})
