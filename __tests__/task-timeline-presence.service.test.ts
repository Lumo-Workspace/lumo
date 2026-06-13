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

import { taskTimelinePresenceService } from '@/lib/services/task-timeline-presence.service'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'
import { acceptanceCriterionRepository } from '@/lib/repositories/acceptance-criterion.repository'

const mockMemory = memoryRepository.hasForTask as jest.Mock
const mockLineage = lineageEdgeRepository.hasForTask as jest.Mock
const mockCriteria = acceptanceCriterionRepository.countByTask as jest.Mock

function setRepos({
  memory,
  lineage,
  criteria = 0,
}: {
  memory: boolean
  lineage: boolean
  criteria?: number
}) {
  mockMemory.mockResolvedValue(memory)
  mockLineage.mockResolvedValue(lineage)
  mockCriteria.mockResolvedValue(criteria)
}

beforeEach(() => jest.clearAllMocks())

describe('taskTimelinePresenceService.getPresence', () => {
  it('passes through memory, lineage, and criteria presence', async () => {
    setRepos({ memory: true, lineage: true, criteria: 4 })

    const presence = await taskTimelinePresenceService.getPresence('task-1')

    expect(presence).toEqual({
      hasMemories: true,
      hasLineage: true,
      hasCriteria: true,
    })
  })

  it('reports hasCriteria=false when the task has no criteria', async () => {
    setRepos({ memory: false, lineage: false, criteria: 0 })

    const presence = await taskTimelinePresenceService.getPresence('task-1')

    expect(presence.hasCriteria).toBe(false)
  })

  it('queries all repositories by task id', async () => {
    setRepos({ memory: false, lineage: false })

    await taskTimelinePresenceService.getPresence('task-42')

    expect(mockMemory).toHaveBeenCalledWith('task-42')
    expect(mockLineage).toHaveBeenCalledWith('task-42')
    expect(mockCriteria).toHaveBeenCalledWith('task-42')
  })
})
