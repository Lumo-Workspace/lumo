/**
 * @jest-environment node
 *
 * LUM-590 — service tests for boundaryCrossingService.explainCrossing.
 * Tests:
 *   (a) CACHE HIT: a crossing with systemExplanation set returns it without
 *       calling the LLM (spy asserts not called).
 *   (b) GENERATE: null systemExplanation → calls LLM once, persists, returns.
 * Non-vacuous: stateful mock for findForExplanation.
 */
jest.mock('@/lib/repositories/boundary-crossing.repository', () => ({
  boundaryCrossingRepository: {
    findForExplanation: jest.fn(),
    findById: jest.fn(),
    setSystemExplanation: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/hook-event.repository', () => ({
  hookEventRepository: {
    findManyByIdsForAttribution: jest.fn().mockResolvedValue([]),
    findTurnSummariesForSessions: jest.fn().mockResolvedValue([]),
  },
}))

// Mock every other repository import the service uses so the module loads.
jest.mock('@/lib/repositories/activity.repository', () => ({
  activityRepository: { listDispositionChangesByTask: jest.fn() },
}))
jest.mock('@/lib/repositories/member.repository', () => ({
  memberRepository: { findActorByMemberId: jest.fn() },
}))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: { findWithProject: jest.fn() },
}))
jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    findManyForAttribution: jest.fn(),
    findTaskBinding: jest.fn(),
  },
}))
jest.mock('@/lib/repositories/pull-request.repository', () => ({
  pullRequestRepository: { findByTaskId: jest.fn() },
}))
jest.mock('@/lib/services/task-creation.service', () => ({
  createTask: jest.fn(),
}))
jest.mock('@/lib/services/task-dependency.service', () => ({
  taskDependencyService: { addManual: jest.fn() },
}))
jest.mock('@/lib/utils/sanitize', () => ({
  sanitizeField: (s: string) => s,
}))

// LLM client — dynamic import mocked at the module level.
const mockExplainLLM = jest.fn()
jest.mock('@/lib/llm/crossing-explain-client', () => ({
  explainCrossing: (...args: unknown[]) => mockExplainLLM(...args),
}))

import { boundaryCrossingRepository } from '@/lib/repositories/boundary-crossing.repository'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'

const mockFindForExplanation =
  boundaryCrossingRepository.findForExplanation as jest.Mock
const mockFindById = boundaryCrossingRepository.findById as jest.Mock
const mockSetSystemExplanation =
  boundaryCrossingRepository.setSystemExplanation as jest.Mock

const BASE_ROW = {
  id: 'bc-1',
  taskId: 'task-1',
  category: 'PROJECT_RULE_VIOLATION',
  severity: 'HIGH',
  detail: 'DROP TABLE users',
  policyRuleText: 'No destructive SQL',
  systemExplanation: null,
}

beforeEach(() => {
  jest.clearAllMocks()
  // findById used for hookEventId lookup (agentContext derivation).
  mockFindById.mockResolvedValue({
    id: 'bc-1',
    taskId: 'task-1',
    hookEventId: null,
  })
  // The repository echoes what it stored (LUM-904: the service returns it).
  mockSetSystemExplanation.mockImplementation(
    async (id: string, text: string) => ({ id, systemExplanation: text })
  )
})

describe('boundaryCrossingService.explainCrossing (LUM-590)', () => {
  describe('CACHE HIT — systemExplanation already set', () => {
    it('returns the cached explanation without calling the LLM', async () => {
      mockFindForExplanation.mockResolvedValue({
        ...BASE_ROW,
        systemExplanation: 'Cached explanation text.',
      })

      const result = await boundaryCrossingService.explainCrossing(
        'task-1',
        'bc-1'
      )

      expect(result).toEqual({ explanation: 'Cached explanation text.' })
      expect(mockExplainLLM).not.toHaveBeenCalled()
      expect(mockSetSystemExplanation).not.toHaveBeenCalled()
    })
  })

  describe('GENERATE — systemExplanation is null', () => {
    it('calls LLM once, persists the result, and returns the explanation', async () => {
      mockFindForExplanation.mockResolvedValue({ ...BASE_ROW })
      mockExplainLLM.mockResolvedValue({
        explanation: 'LLM-generated explanation.',
      })
      mockSetSystemExplanation.mockResolvedValue({
        id: 'bc-1',
        systemExplanation: 'LLM-generated explanation.',
      })

      const result = await boundaryCrossingService.explainCrossing(
        'task-1',
        'bc-1'
      )

      expect(mockExplainLLM).toHaveBeenCalledTimes(1)
      expect(mockExplainLLM).toHaveBeenCalledWith(
        expect.objectContaining({
          rule: 'No destructive SQL',
          evidence: 'DROP TABLE users',
          category: 'PROJECT_RULE_VIOLATION',
          severity: 'HIGH',
        })
      )
      expect(mockSetSystemExplanation).toHaveBeenCalledWith(
        'bc-1',
        'LLM-generated explanation.'
      )
      expect(result).toEqual({ explanation: 'LLM-generated explanation.' })
    })

    it('throws 502 when the LLM call fails, and does NOT persist', async () => {
      mockFindForExplanation.mockResolvedValue({ ...BASE_ROW })
      mockExplainLLM.mockRejectedValue(new Error('LLM timeout'))

      await expect(
        boundaryCrossingService.explainCrossing('task-1', 'bc-1')
      ).rejects.toMatchObject({ status: 502 })

      expect(mockSetSystemExplanation).not.toHaveBeenCalled()
    })
  })

  describe('scope guard', () => {
    it('throws 404 when the crossing does not belong to the task', async () => {
      mockFindForExplanation.mockResolvedValue({
        ...BASE_ROW,
        taskId: 'task-other',
      })

      await expect(
        boundaryCrossingService.explainCrossing('task-1', 'bc-1')
      ).rejects.toMatchObject({ status: 404 })
    })

    it('throws 404 when the crossing is not found', async () => {
      mockFindForExplanation.mockResolvedValue(null)

      await expect(
        boundaryCrossingService.explainCrossing('task-1', 'bc-1')
      ).rejects.toMatchObject({ status: 404 })
    })
  })
})
