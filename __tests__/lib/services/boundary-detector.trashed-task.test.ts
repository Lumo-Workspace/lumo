/**
 * LUM-923 — a task in the trash collects no new boundary crossings: the
 * hook-driven detector skips it before recording anything, while a task it
 * cannot find in the trash (live, or unknown) still records as before.
 */
import { boundaryDetectorService } from '@/lib/services/boundary-detector.service'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { activityRepository } from '@/lib/repositories/activity.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: jest.fn(),
    coalesceRecurrence: jest.fn().mockResolvedValue(0),
  },
}))
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: jest.fn() },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: {
    listByTask: jest.fn().mockResolvedValue([]),
  },
}))
jest.mock('@/lib/repositories/task.repository', () => {
  const actual = jest.requireActual('@/lib/repositories/task.repository')
  return {
    ...actual,
    taskRepository: { ...actual.taskRepository, isTrashed: jest.fn() },
  }
})

const createCrossing = boundaryCrossingRepository.create as jest.Mock
const createActivity = activityRepository.create as jest.Mock
const isTrashed = taskRepository.isTrashed as jest.Mock

const pushToMain = {
  taskId: 't-1',
  hookEventId: 'evt-1',
  toolName: 'Bash',
  filePath: null,
  payload: { tool_input: { command: 'git push origin main --force' } },
}

beforeEach(() => {
  jest.clearAllMocks()
  createCrossing.mockResolvedValue({ id: 'bc-1' })
  createActivity.mockResolvedValue({ id: 'act-1' })
})

describe('LUM-923 trash leak: crossings on trashed tasks', () => {
  it('LUM-923 trash leak: no crossing or timeline marker is recorded on a trashed task', async () => {
    isTrashed.mockResolvedValue(true)

    await boundaryDetectorService.detectAndRecord(pushToMain)

    expect(isTrashed).toHaveBeenCalledWith('t-1')
    expect(createCrossing).not.toHaveBeenCalled()
    expect(createActivity).not.toHaveBeenCalled()
  })

  it('LUM-923 trash leak: a task not found in the trash still records its crossing', async () => {
    isTrashed.mockResolvedValue(false)

    await boundaryDetectorService.detectAndRecord(pushToMain)

    expect(createCrossing).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        category: 'PUSH_TO_PROTECTED_BRANCH',
      })
    )
  })
})
