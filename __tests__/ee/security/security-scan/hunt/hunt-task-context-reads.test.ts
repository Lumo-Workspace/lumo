/** @jest-environment node */
/**
 * LUM-764 — the four reads behind the planner's task view. The planner is a
 * FAST-bucket routing call that already has a deterministic floor underneath
 * it, so a signal that cannot be read is worth one warn line and nothing
 * more: `loadHuntTaskContext` never throws, and one dead read never takes the
 * other three with it.
 */
jest.mock('@/lib/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { findUndispositionedByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: { findActiveTrapMemoriesByProject: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findProjectId: jest.fn() },
}))

import { loadHuntTaskContext } from '@/ee/security/services/security-hunt-task-context'
import { logger } from '@/lib/logger'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { taskRepository } from '@/lib/repositories/task.repository'

const crossingMock =
  boundaryCrossingRepository.findUndispositionedByTask as jest.Mock
const trapMock = memoryRepository.findActiveTrapMemoriesByProject as jest.Mock
const projectMock = taskRepository.findProjectId as jest.Mock

function healthy(): void {
  projectMock.mockResolvedValue({ projectId: 'p1' })
  trapMock.mockResolvedValue([
    {
      id: 'm1',
      content: {
        trigger: 'passing a raw id to findUnique',
        outcome: 'cross-workspace read',
      },
    },
  ])
  crossingMock.mockResolvedValue([
    {
      category: 'TEST_FILE_DELETED',
      target: '__tests__/scope.test.ts',
      detail: 'deleted while work was in progress',
    },
    // Not an L4 session-guard category — the planner gets the intent
    // evidence, not every crossing the workspace ever recorded.
    { category: 'NEW_DEPENDENCY', target: 'left-pad', detail: 'added' },
  ])
}

beforeEach(() => {
  jest.clearAllMocks()
  healthy()
})

describe('LUM-764 hunt task-context reads', () => {
  it('reads the signals a scanner cannot see', async () => {
    const context = await loadHuntTaskContext('task1')
    expect(context.traps).toEqual([
      'passing a raw id to findUnique → cross-workspace read',
    ])
    expect(context.crossings).toEqual([
      'TEST_FILE_DELETED: __tests__/scope.test.ts deleted while work was in progress',
    ])
  })

  it('a failing task-context read drops only that signal and never throws', async () => {
    crossingMock.mockRejectedValueOnce(new Error('db down'))
    const context = await loadHuntTaskContext('task1')

    expect(context.crossings).toEqual([])
    // The other read is untouched — one dead read is not two.
    expect(context.traps).toHaveLength(1)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('task-context crossings read failed')
    )

    // Same for the trap path, whose first hop is a second repository.
    projectMock.mockRejectedValueOnce(new Error('db down'))
    const noTraps = await loadHuntTaskContext('task1')
    expect(noTraps.traps).toEqual([])
    expect(noTraps.crossings).toHaveLength(1)

    // And when everything is down it degrades to "no task context", which is
    // the option-B switch: no floor, LUM-758 behaviour, no crash.
    projectMock.mockRejectedValueOnce(new Error('x'))
    crossingMock.mockRejectedValueOnce(new Error('x'))
    await expect(loadHuntTaskContext('task1')).resolves.toEqual({
      traps: [],
      crossings: [],
    })
  })

  it('skips a trap row whose content does not match the schema instead of throwing', async () => {
    trapMock.mockResolvedValue([
      { id: 'm1', content: { trigger: 'only half a trap' } },
      { id: 'm2', content: null },
      { id: 'm3', content: { trigger: 'a', outcome: 'b' } },
    ])
    const context = await loadHuntTaskContext('task1')
    expect(context.traps).toEqual(['a → b'])
  })

  it('asks no repository anything when the pull request has no task', async () => {
    const context = await loadHuntTaskContext(null)
    expect(context).toEqual({ traps: [], crossings: [] })
    expect(projectMock).not.toHaveBeenCalled()
    expect(crossingMock).not.toHaveBeenCalled()
  })
})
