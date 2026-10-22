/**
 * @jest-environment node
 */
// LUM-1286 step 2: stamping Task.titleEmbedding.

jest.mock('@/lib/ai/embedding', () => ({ embedTexts: jest.fn() }))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    setTitleEmbedding: jest.fn(),
    findMissingTitleEmbeddings: jest.fn(),
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import { embedTexts } from '@/lib/ai/embedding'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  backfillTaskTitleEmbeddings,
  stampTaskTitleEmbedding,
} from '@/lib/services/task-embedding.service'

const mockEmbed = embedTexts as jest.Mock
const mockSet = taskRepository.setTitleEmbedding as jest.Mock
const mockMissing = taskRepository.findMissingTitleEmbeddings as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('stampTaskTitleEmbedding', () => {
  it('embeds the title and stores the vector on the task', async () => {
    mockEmbed.mockResolvedValue([[0.1, 0.2]])

    await stampTaskTitleEmbedding('task_1', 'Add Google OAuth login')

    expect(mockEmbed).toHaveBeenCalledWith(['Add Google OAuth login'])
    expect(mockSet).toHaveBeenCalledWith('task_1', [0.1, 0.2])
  })

  it('never throws: an embedding failure is logged and the task is left as is', async () => {
    mockEmbed.mockRejectedValue(new Error('gateway down'))

    await expect(
      stampTaskTitleEmbedding('task_1', 'Add Google OAuth login')
    ).resolves.toBeUndefined()
    expect(mockSet).not.toHaveBeenCalled()
  })

  it('skips a blank title', async () => {
    await stampTaskTitleEmbedding('task_1', '   ')
    expect(mockEmbed).not.toHaveBeenCalled()
  })
})

describe('backfillTaskTitleEmbeddings', () => {
  it('embeds missing titles in batches until none are left or the limit is reached', async () => {
    mockMissing
      .mockResolvedValueOnce([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ])
      .mockResolvedValueOnce([{ id: 'c', title: 'C' }])
      .mockResolvedValueOnce([])
    mockEmbed.mockImplementation(async (xs: string[]) => xs.map(() => [1]))

    const out = await backfillTaskTitleEmbeddings({ batchSize: 2, limit: 10 })

    expect(out).toEqual({ embedded: 3, failed: 0 })
    expect(mockSet).toHaveBeenCalledTimes(3)
    expect(mockMissing).toHaveBeenNthCalledWith(1, 2)
  })

  it('stops at the limit', async () => {
    mockMissing.mockResolvedValue([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ])
    mockEmbed.mockImplementation(async (xs: string[]) => xs.map(() => [1]))

    const out = await backfillTaskTitleEmbeddings({ batchSize: 2, limit: 2 })

    expect(out.embedded).toBe(2)
    expect(mockMissing).toHaveBeenCalledTimes(1)
  })

  it('stops instead of looping forever when a batch cannot be embedded', async () => {
    mockMissing.mockResolvedValue([{ id: 'a', title: 'A' }])
    mockEmbed.mockRejectedValue(new Error('gateway down'))

    const out = await backfillTaskTitleEmbeddings({ batchSize: 1, limit: 100 })

    expect(out).toEqual({ embedded: 0, failed: 1 })
    expect(mockMissing).toHaveBeenCalledTimes(1)
  })
})

describe('backfillTaskTitleEmbeddings — partial batches (LUM-1286)', () => {
  it('counts only stored vectors and stops when a batch comes back short', async () => {
    mockMissing.mockResolvedValue([
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
    ])
    mockEmbed.mockResolvedValue([[1]]) // one vector for two titles

    const out = await backfillTaskTitleEmbeddings({ batchSize: 2, limit: 10 })

    expect(out).toEqual({ embedded: 1, failed: 1 })
    expect(mockSet).toHaveBeenCalledTimes(1)
    expect(mockMissing).toHaveBeenCalledTimes(1)
  })
})
