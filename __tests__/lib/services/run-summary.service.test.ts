import { runSummaryService } from '@/lib/services/run-summary.service'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import { callRunSummaryLLM } from '@/lib/llm/run-summary-client'

jest.mock('@/lib/repositories/session.repository', () => ({
  sessionRepository: {
    listForTaskMissingRunSummary: jest.fn(),
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

const mockList = sessionRepository.listForTaskMissingRunSummary as jest.Mock
const mockSet = sessionRepository.setRunSummary as jest.Mock
const mockTitle = taskRepository.getTitleAndStatus as jest.Mock
const mockLLM = callRunSummaryLLM as jest.Mock

describe('run summary generation on DONE', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockTitle.mockResolvedValue({ title: 'Add OAuth login', status: 'DONE' })
  })

  it('generates and persists for sessions with turn summaries', async () => {
    mockList.mockResolvedValue([
      { id: 'sess-1', events: [{ turnSummary: 'a' }] },
    ])
    mockLLM.mockResolvedValue('Generated summary.')

    const result = await runSummaryService.generateForTask('task-1')

    expect(mockLLM).toHaveBeenCalledWith({
      taskTitle: 'Add OAuth login',
      turnSummaries: ['a'],
    })
    expect(mockSet).toHaveBeenCalledTimes(1)
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

  it('skips sessions with no turn summaries and is not degraded (legit-empty)', async () => {
    mockList.mockResolvedValue([{ id: 'sess-1', events: [] }])

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
    mockList.mockResolvedValue([
      { id: 'sess-1', events: [{ turnSummary: 'a' }] },
      { id: 'sess-2', events: [{ turnSummary: 'b' }] },
    ])
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
    mockList.mockResolvedValue([
      { id: 'sess-1', events: [{ turnSummary: 'a' }] },
      { id: 'sess-2', events: [{ turnSummary: 'b' }] },
    ])
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
    // One empty session (skipped, not a failure) + one with material that
    // errors — the empty one must not mask or trip the degraded flag.
    mockList.mockResolvedValue([
      { id: 'sess-1', events: [] },
      { id: 'sess-2', events: [{ turnSummary: 'b' }] },
    ])
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
    mockList.mockRejectedValue(new Error('db down'))

    const result = await runSummaryService.generateForTask('task-1')

    expect(result.degraded).toBe(true)
    expect(mockLLM).not.toHaveBeenCalled()
  })
})
