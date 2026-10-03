import { runSummaryService } from '@/lib/services/run-summary.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { callRunSummaryLLM } from '@/lib/llm/run-summary-client'
import { taskClaimSnapshotService } from '@/lib/services/task-claim-snapshot.service'
import type { RawEvent } from '@/lib/services/session-summary/compact-events'

// LUM-917: the AI-derived content switch (on unless a test turns it off).
const mockAiDerivedEnabled = jest.fn()
jest.mock('@/lib/services/ai-derived-content.service', () => ({
  aiDerivedContentService: {
    isEnabled: (...args: unknown[]) => mockAiDerivedEnabled(...args),
  },
}))

jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTaskMissingRunSummary: jest.fn(),
    listSessionIdsForTask: jest.fn(),
    listEventsForSession: jest.fn(),
    setRunSummary: jest.fn(),
  },
}))

jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    getTitleAndStatus: jest.fn(),
  },
}))

jest.mock('@/lib/llm/run-summary-client', () => ({
  callRunSummaryLLM: jest.fn(),
}))

jest.mock('@/lib/services/task-claim-snapshot.service', () => ({
  taskClaimSnapshotService: { synthesizeForTask: jest.fn() },
}))

const mockMissing = sessionRepository.listForTaskMissingRunSummary as jest.Mock
const mockAllIds = sessionRepository.listSessionIdsForTask as jest.Mock
const mockEvents = sessionRepository.listEventsForSession as jest.Mock
const mockSet = sessionRepository.setRunSummary as jest.Mock
const mockTitle = taskRepository.getTitleAndStatus as jest.Mock
const mockLLM = callRunSummaryLLM as jest.Mock
const mockSynthesize = taskClaimSnapshotService.synthesizeForTask as jest.Mock

let seq = 0
/** A PRE+POST tool-call pair that compacts to one delivery line. */
function editEvents(path: string): RawEvent[] {
  seq += 1
  const tuid = `t-${seq}`
  return [
    {
      id: `pre-${seq}`,
      type: 'PRE_TOOL_USE',
      toolName: 'Edit',
      payload: { tool_use_id: tuid, tool_input: { file_path: path } },
      createdAt: new Date(1_700_000_000_000 + seq * 1000),
    },
    {
      id: `post-${seq}`,
      type: 'POST_TOOL_USE',
      toolName: 'Edit',
      payload: { tool_use_id: tuid, tool_response: {} },
      createdAt: new Date(1_700_000_000_000 + seq * 1000 + 1),
    },
  ]
}

beforeEach(() => {
  jest.clearAllMocks()
  mockAiDerivedEnabled.mockResolvedValue(true)
  seq = 0
  mockTitle.mockResolvedValue({ title: 'Add OAuth login', status: 'DONE' })
  mockSynthesize.mockResolvedValue(undefined)
})

describe('run summary generation on DONE (event-stream input)', () => {
  it('generates nothing when AI-derived content is off, but still freezes the claim snapshot (LUM-917)', async () => {
    mockAiDerivedEnabled.mockResolvedValue(false)
    mockMissing.mockResolvedValue(['sess-1'])
    mockEvents.mockResolvedValue(editEvents('/a.ts'))

    const result = await runSummaryService.generateForTask('task-1')

    expect(mockAiDerivedEnabled).toHaveBeenCalledWith({ taskId: 'task-1' })
    expect(mockLLM).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockSynthesize).toHaveBeenCalledWith('task-1')
    expect(result).toEqual({
      generated: 0,
      failed: 0,
      skippedEmpty: 0,
      degraded: false,
    })
  })

  it('generates from the compacted event stream and persists, for sessions missing a summary', async () => {
    mockMissing.mockResolvedValue(['sess-1'])
    mockEvents.mockResolvedValue(editEvents('/a.ts'))
    mockLLM.mockResolvedValue('Generated summary.')

    const result = await runSummaryService.generateForTask('task-1')

    // The LLM is fed the compacted event log, not turn summaries.
    const arg = mockLLM.mock.calls[0]![0]
    expect(arg.taskTitle).toBe('Add OAuth login')
    expect(arg.eventLog).toContain('Edit /a.ts')
    expect(mockSet).toHaveBeenCalledWith(
      'sess-1',
      'Generated summary.',
      expect.any(Date)
    )
    expect(result).toEqual({
      generated: 1,
      failed: 0,
      skippedEmpty: 0,
      degraded: false,
    })
  })

  it('skips sessions with no usable events and is not degraded (legit-empty)', async () => {
    mockMissing.mockResolvedValue(['sess-1'])
    mockEvents.mockResolvedValue([])

    const result = await runSummaryService.generateForTask('task-1')

    expect(mockLLM).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
    expect(result).toEqual({
      generated: 0,
      failed: 0,
      skippedEmpty: 1,
      degraded: false,
    })
  })

  it('swallows a per-session LLM error without throwing', async () => {
    mockMissing.mockResolvedValue(['sess-1', 'sess-2'])
    mockEvents
      .mockResolvedValueOnce(editEvents('/a.ts'))
      .mockResolvedValueOnce(editEvents('/b.ts'))
    mockLLM
      .mockRejectedValueOnce(new Error('llm down'))
      .mockResolvedValueOnce('Second summary.')

    await expect(
      runSummaryService.generateForTask('task-1')
    ).resolves.not.toThrow()

    expect(mockSet).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalledWith(
      'sess-2',
      'Second summary.',
      expect.any(Date)
    )
  })

  it('reports a degraded result when a qualified session errors (observable, not swallowed)', async () => {
    mockMissing.mockResolvedValue(['sess-1', 'sess-2'])
    mockEvents
      .mockResolvedValueOnce(editEvents('/a.ts'))
      .mockResolvedValueOnce(editEvents('/b.ts'))
    mockLLM
      .mockRejectedValueOnce(new Error('llm down'))
      .mockResolvedValueOnce('Second summary.')

    const result = await runSummaryService.generateForTask('task-1')

    expect(result).toEqual({
      generated: 1,
      failed: 1,
      skippedEmpty: 0,
      degraded: true,
    })
  })

  it('a degraded LLM failure is distinct from a legitimately-empty session', async () => {
    mockMissing.mockResolvedValue(['sess-1', 'sess-2'])
    mockEvents
      .mockResolvedValueOnce([]) // empty → skipped
      .mockResolvedValueOnce(editEvents('/b.ts')) // material → errors
    mockLLM.mockRejectedValue(new Error('llm down'))

    const result = await runSummaryService.generateForTask('task-1')

    expect(result).toEqual({
      generated: 0,
      failed: 1,
      skippedEmpty: 1,
      degraded: true,
    })
  })

  it('reports degraded when the session repo itself throws (outer failure)', async () => {
    mockMissing.mockRejectedValue(new Error('db down'))

    const result = await runSummaryService.generateForTask('task-1')

    expect(result.degraded).toBe(true)
    expect(mockLLM).not.toHaveBeenCalled()
  })
})

describe('run summary force-regeneration (LUM-579)', () => {
  it('force-regenerates run summary from stored events for an already-summarized session', async () => {
    // The session already HAS a (stale, early-biased) summary; the force path
    // must reach it via listSessionIdsForTask (all sessions, not just missing)
    // and overwrite it from the stored event stream.
    mockAllIds.mockResolvedValue(['sess-delivered'])
    const events = editEvents('/lib/run-summary.service.ts')
    mockEvents.mockResolvedValue(events)
    mockLLM.mockResolvedValue(
      'Implemented the run-summary fix; changed lib/run-summary.service.ts.'
    )

    const result = await runSummaryService.regenerateForTask('task-1')

    // Pulled ALL sessions (force), not the missing-only set.
    expect(mockAllIds).toHaveBeenCalledWith('task-1')
    expect(mockMissing).not.toHaveBeenCalled()
    // Input derived from the events, covering the delivery edit.
    const arg = mockLLM.mock.calls[0]![0]
    expect(arg.eventLog).toContain('Edit /lib/run-summary.service.ts')
    // Overwrites the existing summary and re-freezes the claim snapshot.
    expect(mockSet).toHaveBeenCalledWith(
      'sess-delivered',
      'Implemented the run-summary fix; changed lib/run-summary.service.ts.',
      expect.any(Date)
    )
    expect(mockSynthesize).toHaveBeenCalledWith('task-1')
    expect(result).toEqual({
      generated: 1,
      failed: 0,
      skippedEmpty: 0,
      degraded: false,
    })

    // Idempotency: the input the regen builds is a pure function of the stored
    // events — re-running yields the byte-identical event log.
    await runSummaryService.regenerateForTask('task-1')
    expect(mockLLM.mock.calls[1]![0].eventLog).toBe(arg.eventLog)
  })
})
