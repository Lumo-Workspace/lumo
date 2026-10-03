/** @jest-environment node */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: { hasForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { hasForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { hasOpenForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/test-case.repository', () => ({
  testCaseRepository: { hasForTask: jest.fn() },
}))

import { taskTimelinePresenceService } from '@/lib/services/task-timeline-presence.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { testCaseRepository } from '@/lib/repositories/test-case.repository'

const mockMemory = memoryRepository.hasForTask as jest.Mock
const mockLineage = lineageEdgeRepository.hasForTask as jest.Mock
const mockOpenCrossings = boundaryCrossingRepository.hasOpenForTask as jest.Mock
const mockTestCases = testCaseRepository.hasForTask as jest.Mock

function setRepos({
  memory,
  lineage,
  openCrossings = false,
  testCases = false,
}: {
  memory: boolean
  lineage: boolean
  openCrossings?: boolean
  testCases?: boolean
}) {
  mockMemory.mockResolvedValue(memory)
  mockLineage.mockResolvedValue(lineage)
  mockOpenCrossings.mockResolvedValue(openCrossings)
  mockTestCases.mockResolvedValue(testCases)
}

beforeEach(() => jest.clearAllMocks())

describe('taskTimelinePresenceService.getPresence', () => {
  it('passes through memory, lineage, crossing and test-case presence', async () => {
    setRepos({
      memory: true,
      lineage: true,
      openCrossings: true,
      testCases: true,
    })

    const presence = await taskTimelinePresenceService.getPresence('task-1')

    expect(presence).toEqual({
      hasMemories: true,
      hasLineage: true,
      hasOpenCrossings: true,
      hasTestCases: true,
    })
  })

  it('hasOpenCrossings reflects undispositioned crossings', async () => {
    setRepos({ memory: false, lineage: false, openCrossings: true })
    expect(
      (await taskTimelinePresenceService.getPresence('task-1')).hasOpenCrossings
    ).toBe(true)

    setRepos({ memory: false, lineage: false, openCrossings: false })
    expect(
      (await taskTimelinePresenceService.getPresence('task-2')).hasOpenCrossings
    ).toBe(false)
  })

  it('queries all repositories by task id', async () => {
    setRepos({ memory: false, lineage: false })

    await taskTimelinePresenceService.getPresence('task-42')

    expect(mockMemory).toHaveBeenCalledWith('task-42')
    expect(mockLineage).toHaveBeenCalledWith('task-42')
    expect(mockOpenCrossings).toHaveBeenCalledWith('task-42')
    expect(mockTestCases).toHaveBeenCalledWith('task-42')
  })

  it('reports hasTestCases from the test-case repository (LUM-801)', async () => {
    setRepos({ memory: false, lineage: false, testCases: true })
    expect(
      (await taskTimelinePresenceService.getPresence('task-1')).hasTestCases
    ).toBe(true)

    setRepos({ memory: false, lineage: false, testCases: false })
    expect(
      (await taskTimelinePresenceService.getPresence('task-2')).hasTestCases
    ).toBe(false)
  })
})
