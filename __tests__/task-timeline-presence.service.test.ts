/** @jest-environment node */
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: { hasToolUseForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: { hasForTask: jest.fn() },
}))
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: { hasForTask: jest.fn() },
}))

import { taskTimelinePresenceService } from '@/lib/services/task-timeline-presence.service'
import { hookEventRepository } from '@/lib/repositories/hook-event.repository'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { lineageEdgeRepository } from '@/lib/repositories/lineage-edge.repository'

const mockToolUse = hookEventRepository.hasToolUseForTask as jest.Mock
const mockMemory = memoryRepository.hasForTask as jest.Mock
const mockLineage = lineageEdgeRepository.hasForTask as jest.Mock

function setRepos({
  toolUse,
  memory,
  lineage,
}: {
  toolUse: boolean
  memory: boolean
  lineage: boolean
}) {
  mockToolUse.mockResolvedValue(toolUse)
  mockMemory.mockResolvedValue(memory)
  mockLineage.mockResolvedValue(lineage)
}

beforeEach(() => jest.clearAllMocks())

describe('taskTimelinePresenceService.getPresence', () => {
  it('reports hasAgentRuns when the task has tool-use events but no memories', async () => {
    setRepos({ toolUse: true, memory: false, lineage: false })

    const presence = await taskTimelinePresenceService.getPresence('task-1')

    // agentRunTimelineService keeps a run when toolCallCount>0 OR memoryCount>0;
    // a tool-use event alone is enough to render the Agent Run tab.
    expect(presence.hasAgentRuns).toBe(true)
    expect(presence.hasMemories).toBe(false)
  })

  it('reports hasAgentRuns when the task has memories but no tool-use events', async () => {
    setRepos({ toolUse: false, memory: true, lineage: false })

    const presence = await taskTimelinePresenceService.getPresence('task-1')

    // A sedimented/manual memory makes memoryCount>0, so a run survives the
    // nonEmptyRuns filter even with zero tool calls.
    expect(presence.hasAgentRuns).toBe(true)
    expect(presence.hasMemories).toBe(true)
  })

  it('hides the Agent Run tab when the task has neither tool-use events nor memories', async () => {
    setRepos({ toolUse: false, memory: false, lineage: false })

    const presence = await taskTimelinePresenceService.getPresence('task-1')

    expect(presence.hasAgentRuns).toBe(false)
  })

  it('passes through memory and lineage presence', async () => {
    setRepos({ toolUse: false, memory: true, lineage: true })

    const presence = await taskTimelinePresenceService.getPresence('task-1')

    expect(presence).toEqual({
      hasAgentRuns: true,
      hasMemories: true,
      hasLineage: true,
    })
  })

  it('queries all three repositories by task id', async () => {
    setRepos({ toolUse: false, memory: false, lineage: false })

    await taskTimelinePresenceService.getPresence('task-42')

    expect(mockToolUse).toHaveBeenCalledWith('task-42')
    expect(mockMemory).toHaveBeenCalledWith('task-42')
    expect(mockLineage).toHaveBeenCalledWith('task-42')
  })
})
