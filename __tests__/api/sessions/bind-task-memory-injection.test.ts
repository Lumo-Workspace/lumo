/**
 * @jest-environment node
 */
jest.mock('@/lib/services/task-context.service', () => ({
  taskContextService: {
    buildMemorySectionForTask: jest.fn(),
    buildCriteriaSectionForTask: jest.fn(),
    buildPreviousSessionRecoveryForTask: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    upsertWithTaskId: jest.fn(),
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
jest.mock('@/lib/services/task.service', () => ({
  taskService: {
    resolveIdentifier: jest.fn(),
  },
}))

import { sessionService } from '@/lib/services/session.service'
import { taskContextService } from '@/lib/services/task-context.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskService } from '@/lib/services/task.service'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'

describe('sessionService.bindSessionToTask — memory injection', () => {
  const identity = {
    user: { id: 'user-1', email: 'a@b.c', name: 'A' },
    workspace: { id: 'ws-1', slug: 'ws', name: 'WS' },
    apiKey: { id: 'key-1', name: 'laptop', prefix: 'lum_abc' },
  }

  beforeEach(() => {
    jest.resetAllMocks()
    ;(miscRepository.findMemberIdForHook as jest.Mock).mockResolvedValue('wm-1')
    ;(taskService.resolveIdentifier as jest.Mock).mockResolvedValue({
      id: 'task-1',
      identifier: 'LUM-42',
      title: 'Test task',
    })
    ;(sessionRepository.upsertWithTaskId as jest.Mock).mockResolvedValue({
      ownedByOther: false,
      session: { id: 's-1', taskId: 'task-1' },
    })
    ;(
      sessionRepository.findForMemberWithBinding as jest.Mock
    ).mockResolvedValue(null)
    ;(
      hookEventRepository.bulkSetTaskIdForNullEventsInSession as jest.Mock
    ).mockResolvedValue({ count: 0 })
    ;(
      taskContextService.buildPreviousSessionRecoveryForTask as jest.Mock
    ).mockResolvedValue(null)
  })

  it('returns memorySection from buildMemorySectionForTask', async () => {
    ;(
      taskContextService.buildMemorySectionForTask as jest.Mock
    ).mockResolvedValue(
      '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n'
    )

    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 's-1',
      taskIdentifier: 'LUM-42',
    })

    if (result.status !== 'bound') throw new Error('expected bound result')
    expect(result.memorySection).toBe(
      '## Relevant Memory\n\n### Traps\n- [task] **X** → Y\n'
    )
    expect(taskContextService.buildMemorySectionForTask).toHaveBeenCalledWith(
      'task-1'
    )
  })

  it('returns empty string memorySection when task has no memory', async () => {
    ;(
      taskContextService.buildMemorySectionForTask as jest.Mock
    ).mockResolvedValue('')

    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 's-1',
      taskIdentifier: 'LUM-42',
    })

    if (result.status !== 'bound') throw new Error('expected bound result')
    expect(result.memorySection).toBe('')
  })
})
