/** @jest-environment node */
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: { hasForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { hasForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/acceptance-criterion.repository', () => ({
  acceptanceCriterionRepository: { countByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: { hasOpenForTask: jest.fn() },
}))

import { taskTimelinePresenceService } from '@/lib/services/task-timeline-presence.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'
import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'

const mockMemory = memoryRepository.hasForTask as jest.Mock
const mockLineage = lineageEdgeRepository.hasForTask as jest.Mock
const mockCriteria = acceptanceCriterionRepository.countByTask as jest.Mock
const mockOpenCrossings = boundaryCrossingRepository.hasOpenForTask as jest.Mock

function setRepos({
  memory,
  lineage,
  criteria = 0,
  openCrossings = false,
}: {
  memory: boolean
  lineage: boolean
  criteria?: number
  openCrossings?: boolean
}) {
  mockMemory.mockResolvedValue(memory)
  mockLineage.mockResolvedValue(lineage)
  mockCriteria.mockResolvedValue(criteria)
  mockOpenCrossings.mockResolvedValue(openCrossings)
}

beforeEach(() => jest.clearAllMocks())

describe('taskTimelinePresenceService.getPresence', () => {
  it('passes through memory, lineage, and criteria presence', async () => {
    setRepos({ memory: true, lineage: true, criteria: 4, openCrossings: true })

    const presence = await taskTimelinePresenceService.getPresence('task-1')

    expect(presence).toEqual({
      hasMemories: true,
      hasLineage: true,
      hasCriteria: true,
      hasOpenCrossings: true,
    })
  })

  it('reports hasCriteria=false when the task has no criteria', async () => {
    setRepos({ memory: false, lineage: false, criteria: 0 })

    const presence = await taskTimelinePresenceService.getPresence('task-1')

    expect(presence.hasCriteria).toBe(false)
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
    expect(mockCriteria).toHaveBeenCalledWith('task-42')
    expect(mockOpenCrossings).toHaveBeenCalledWith('task-42')
  })
})
