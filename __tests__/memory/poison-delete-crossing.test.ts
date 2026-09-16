/** @jest-environment node */
/**
 * LUM-793 — the one crossing: an agent hard-deleting a TRAP memory other
 * tasks were already judged to have USED.
 *
 * The three negative cases matter as much as the positive one. This detector
 * sits on an ordinary curation path (`lumo memory rm` on a stale card is
 * healthy), so firing on a never-used memory, on a non-TRAP card, or on a
 * human's browser delete would make it noise the team dismisses on sight.
 */
const mockJudgedUsage = jest.fn()
jest.mock('@/lib/repositories/lineage-edge.repository', () => ({
  lineageEdgeRepository: {
    judgedUsageByFragments: (...a: any[]) => mockJudgedUsage(...a),
  },
}))

const mockFindSession = jest.fn()
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findForMemberWithBinding: (...a: any[]) => mockFindSession(...a),
  },
}))

const mockCrossingCreate = jest.fn()
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    create: (...a: any[]) => mockCrossingCreate(...a),
  },
}))

const mockActivityCreate = jest.fn()
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { create: (...a: any[]) => mockActivityCreate(...a) },
}))

const mockMemoryDelete = jest.fn()
const mockFindById = jest.fn()
jest.mock('@/lib/repositories/memory.repository', () => ({
  memoryRepository: {
    delete: (...a: any[]) => mockMemoryDelete(...a),
    findByIdWithWorkspace: (...a: any[]) => mockFindById(...a),
  },
}))

jest.mock('@/lib/services/memory/canonicalize-language', () => ({
  canonicalizeToEnglish: async (_c: any, x: any) => x,
}))
jest.mock('@/lib/ai/embedding', () => ({ embedTexts: async () => [[0.1]] }))

import { recordUsedTrapMemoryDeletion } from '@/lib/services/memory/used-trap-delete'
import { memoryManagementService } from '@/lib/services/memory-management.service'

const TRAP_MEMORY = {
  id: 'mem-trap',
  category: 'TRAP' as const,
  content: {
    summary: 'Running jest from outside the worktree runs the wrong tests.',
    trigger: 'trigger',
    outcome: 'outcome',
    workaround: 'workaround',
  },
}

const AGENT = {
  sessionId: 'sess-1',
  memberId: 'mem-1',
  source: 'bearer' as const,
}

const usage = (judgedUsedTasks: number) => [
  {
    fragmentType: 'MEMORY',
    fragmentId: TRAP_MEMORY.id,
    judgedUsedTasks,
    auditedTasks: 9,
    appearanceTasks: 40,
  },
]

beforeEach(() => {
  jest.clearAllMocks()
  mockCrossingCreate.mockResolvedValue({ id: 'crossing-1' })
  mockFindSession.mockResolvedValue({
    id: 'sess-1',
    role: 'IMPLEMENTER',
    milestone: null,
    task: { id: 'task-1' },
  })
})

describe('deleting a judged used TRAP memory', () => {
  it('records a boundary crossing against the bound task', async () => {
    mockJudgedUsage.mockResolvedValue(usage(3))
    const result = await recordUsedTrapMemoryDeletion({
      memory: TRAP_MEMORY,
      ...AGENT,
    })

    expect(result).toEqual({ crossingId: 'crossing-1' })
    const input = mockCrossingCreate.mock.calls[0]![0]
    expect(input.category).toBe('USED_TRAP_MEMORY_DELETED')
    expect(input.taskId).toBe('task-1')
    expect(input.sessionId).toBe('sess-1')
    expect(input.target).toBe(TRAP_MEMORY.id)
    expect(input.severity).toBe('MEDIUM')
    expect(input.reversible).toBe(false)
    expect(input.detail).toContain('judged used on 3 of 40')
    expect(mockActivityCreate).toHaveBeenCalledTimes(1)
  })

  it('records nothing when the memory was never judged used', async () => {
    mockJudgedUsage.mockResolvedValue(usage(0))
    expect(
      await recordUsedTrapMemoryDeletion({ memory: TRAP_MEMORY, ...AGENT })
    ).toBeNull()
    expect(mockCrossingCreate).not.toHaveBeenCalled()
  })

  it('records nothing for a non TRAP memory', async () => {
    mockJudgedUsage.mockResolvedValue(usage(5))
    expect(
      await recordUsedTrapMemoryDeletion({
        memory: { ...TRAP_MEMORY, category: 'CONVENTION' },
        ...AGENT,
      })
    ).toBeNull()
    expect(mockJudgedUsage).not.toHaveBeenCalled()
    expect(mockCrossingCreate).not.toHaveBeenCalled()
  })

  it('records nothing for a human browser delete', async () => {
    mockJudgedUsage.mockResolvedValue(usage(5))
    expect(
      await recordUsedTrapMemoryDeletion({
        memory: TRAP_MEMORY,
        sessionId: null,
        memberId: 'mem-1',
        source: 'clerk',
      })
    ).toBeNull()
    expect(mockCrossingCreate).not.toHaveBeenCalled()
  })

  it('records nothing when the session cannot be resolved to a binding', async () => {
    mockJudgedUsage.mockResolvedValue(usage(5))
    mockFindSession.mockResolvedValue(null)
    expect(
      await recordUsedTrapMemoryDeletion({ memory: TRAP_MEMORY, ...AGENT })
    ).toBeNull()
    expect(mockCrossingCreate).not.toHaveBeenCalled()
  })

  it('attributes a steward session to its milestone', async () => {
    mockJudgedUsage.mockResolvedValue(usage(2))
    mockFindSession.mockResolvedValue({
      id: 'sess-1',
      role: 'STEWARD',
      milestone: { id: 'ms-1' },
      task: null,
    })
    await recordUsedTrapMemoryDeletion({ memory: TRAP_MEMORY, ...AGENT })
    const input = mockCrossingCreate.mock.calls[0]![0]
    expect(input.taskId).toBeNull()
    expect(input.milestoneId).toBe('ms-1')
    expect(mockActivityCreate).not.toHaveBeenCalled()
  })

  it('deletes the memory even when recording the crossing fails', async () => {
    mockJudgedUsage.mockRejectedValue(new Error('lineage down'))
    mockFindById.mockResolvedValue(TRAP_MEMORY)
    await memoryManagementService.delete('mem-trap', AGENT)
    expect(mockMemoryDelete).toHaveBeenCalledWith('mem-trap')
  })

  it('runs the detector before the delete on the service path', async () => {
    mockJudgedUsage.mockResolvedValue(usage(4))
    mockFindById.mockResolvedValue(TRAP_MEMORY)
    await memoryManagementService.delete('mem-trap', AGENT)
    expect(mockCrossingCreate).toHaveBeenCalledTimes(1)
    expect(mockMemoryDelete).toHaveBeenCalledWith('mem-trap')
    expect(mockCrossingCreate.mock.invocationCallOrder[0]!).toBeLessThan(
      mockMemoryDelete.mock.invocationCallOrder[0]!
    )
  })

  it('skips detection entirely when no actor context is given', async () => {
    await memoryManagementService.delete('mem-trap')
    expect(mockFindById).not.toHaveBeenCalled()
    expect(mockCrossingCreate).not.toHaveBeenCalled()
    expect(mockMemoryDelete).toHaveBeenCalledWith('mem-trap')
  })
})
