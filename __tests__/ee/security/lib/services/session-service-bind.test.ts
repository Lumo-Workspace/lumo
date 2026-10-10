/**
 * @jest-environment node
 */
/**
 * LUM-1064: plugin half of __tests__/lib/services/session-service-bind.test.ts (split)
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
})
