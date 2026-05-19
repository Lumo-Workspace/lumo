/**
 * @jest-environment node
 */
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findByIdForMember: jest.fn(),
    updateTaskId: jest.fn(),
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

import { sessionRepository } from '@/lib/repositories/session.repository'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { miscRepository } from '@/lib/repositories/misc.repository'
import { taskService } from '@/lib/services/task.service'
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
  misc.findMemberIdForHook.mockResolvedValue('wm_1')
  sessRepo.findByIdForMember.mockResolvedValue({
    id: 'sess_1',
    taskId: null,
  } as never)
  task.resolveIdentifier.mockResolvedValue({
    id: 'task_1',
    identifier: 'LUM-42',
    title: 'Fix login bug',
    status: 'TODO',
  })
  sessRepo.updateTaskId.mockResolvedValue({
    id: 'sess_1',
    taskId: 'task_1',
  } as never)
  hookRepo.bulkSetTaskIdForNullEventsInSession.mockResolvedValue({ count: 3 })
})

describe('sessionService.bindSessionToTask', () => {
  it('binds session to task and re-tags null events', async () => {
    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 'sess_1',
      taskIdentifier: 'LUM-42',
    })

    expect(misc.findMemberIdForHook).toHaveBeenCalledWith('clerk_1', 'ws_1')
    expect(sessRepo.findByIdForMember).toHaveBeenCalledWith('sess_1', 'wm_1')
    expect(task.resolveIdentifier).toHaveBeenCalledWith('ws_1', 'LUM-42')
    expect(sessRepo.updateTaskId).toHaveBeenCalledWith('sess_1', 'task_1')
    expect(hookRepo.bulkSetTaskIdForNullEventsInSession).toHaveBeenCalledWith(
      'sess_1',
      'task_1'
    )
    expect(result).toEqual({
      taskId: 'task_1',
      taskIdentifier: 'LUM-42',
      taskTitle: 'Fix login bug',
      retaggedEventCount: 3,
    })
  })

  it('returns retaggedEventCount: 0 when no null events exist', async () => {
    hookRepo.bulkSetTaskIdForNullEventsInSession.mockResolvedValue({
      count: 0,
    })
    const result = await sessionService.bindSessionToTask({
      identity,
      sessionId: 'sess_1',
      taskIdentifier: 'LUM-42',
    })
    expect(result.retaggedEventCount).toBe(0)
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

  it('throws 404 when session does not exist or belong to user', async () => {
    sessRepo.findByIdForMember.mockResolvedValue(null)
    await expect(
      sessionService.bindSessionToTask({
        identity,
        sessionId: 'sess_1',
        taskIdentifier: 'LUM-42',
      })
    ).rejects.toMatchObject({ status: 404 })
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
  })
})
