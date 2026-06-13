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

    await runSummaryService.generateForTask('task-1')

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
  })

  it('skips sessions with no turn summaries', async () => {
    mockList.mockResolvedValue([{ id: 'sess-1', events: [] }])

    await runSummaryService.generateForTask('task-1')

    expect(mockLLM).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
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
    ).resolves.toBeUndefined()

    expect(mockSet).toHaveBeenCalledTimes(1)
    expect(mockSet).toHaveBeenCalledWith(
      'sess-2',
      'Second summary.',
      expect.any(Date)
    )
  })
})
