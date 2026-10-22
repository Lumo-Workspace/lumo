/**
 * @jest-environment node
 */
// LUM-1286 step 2: stamping Task.titleEmbedding.

jest.mock('@/lib/ai/embedding', () => ({ embedTexts: jest.fn() }))
jest.mock('@/lib/repositories/task.repository', () => ({
  taskRepository: {
    setTitleEmbedding: jest.fn(),
    findMissingTitleEmbeddings: jest.fn(),
    countMissingTitleEmbeddings: jest.fn(),
  },
}))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}))

import { embedTexts } from '@/lib/ai/embedding'
import { logger } from '@/lib/logger'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  backfillTaskTitleEmbeddings,
  runTaskTitleEmbeddingBackfill,
  stampTaskTitleEmbedding,
} from '@/lib/services/task-embedding.service'

const mockEmbed = embedTexts as jest.Mock
const mockSet = taskRepository.setTitleEmbedding as jest.Mock
const mockMissing = taskRepository.findMissingTitleEmbeddings as jest.Mock
const mockCount = taskRepository.countMissingTitleEmbeddings as jest.Mock
const mockLogError = logger.error as jest.Mock

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

    expect(out).toEqual({ embedded: 3, failed: 0, stoppedAtDeadline: false })
    expect(mockSet).toHaveBeenCalledTimes(3)
    expect(mockMissing).toHaveBeenNthCalledWith(1, 2, undefined)
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

    expect(out).toEqual({ embedded: 0, failed: 1, stoppedAtDeadline: false })
    expect(mockMissing).toHaveBeenCalledTimes(1)
  })
})

describe('backfillTaskTitleEmbeddings — bad rows (LUM-1286)', () => {
  const row = (id: string, ms: number) => ({
    id,
    title: id,
    createdAt: new Date(ms),
  })

  it('retries a failed batch one title at a time and skips only the title that still fails', async () => {
    mockMissing
      .mockResolvedValueOnce([row('a', 3), row('bad', 2)])
      .mockResolvedValueOnce([row('c', 1)])
      .mockResolvedValueOnce([])
    mockEmbed.mockImplementation(async (xs: string[]) => {
      if (xs.includes('bad')) throw new Error('rejected title')
      return xs.map(() => [1])
    })

    const out = await backfillTaskTitleEmbeddings({ batchSize: 2, limit: 10 })

    expect(out).toEqual({ embedded: 2, failed: 1, stoppedAtDeadline: false })
    expect(mockSet.mock.calls.map(c => c[0])).toEqual(['a', 'c'])
    // The next page starts after the skipped row instead of re-reading it.
    expect(mockMissing).toHaveBeenNthCalledWith(2, 2, {
      createdAt: new Date(2),
      id: 'bad',
    })
    expect(mockLogError).toHaveBeenCalledWith(
      '[task-embedding] backfill skipped tasks:',
      ['bad']
    )
  })

  it('treats a short batch the same way', async () => {
    mockMissing
      .mockResolvedValueOnce([row('a', 2), row('b', 1)])
      .mockResolvedValueOnce([])
    mockEmbed
      .mockResolvedValueOnce([[1]]) // one vector for two titles
      .mockResolvedValue([[1]])

    const out = await backfillTaskTitleEmbeddings({ batchSize: 2, limit: 10 })

    expect(out).toEqual({ embedded: 2, failed: 0, stoppedAtDeadline: false })
  })

  it('moves on past a page of bad titles when the gateway still answers', async () => {
    mockMissing
      .mockResolvedValueOnce([row('bad1', 4), row('bad2', 3)])
      .mockResolvedValueOnce([row('ok', 1)])
      .mockResolvedValueOnce([])
    mockEmbed.mockImplementation(async (xs: string[]) => {
      if (xs.some(x => x.startsWith('bad'))) throw new Error('rejected title')
      return xs.map(() => [1])
    })

    const out = await backfillTaskTitleEmbeddings({ batchSize: 2, limit: 10 })

    expect(out).toEqual({ embedded: 1, failed: 2, stoppedAtDeadline: false })
    expect(mockSet).toHaveBeenCalledWith('ok', [1])
  })

  it('stops when every title in a page fails (gateway down)', async () => {
    mockMissing.mockResolvedValue([row('a', 2), row('b', 1)])
    mockEmbed.mockRejectedValue(new Error('gateway down'))

    const out = await backfillTaskTitleEmbeddings({ batchSize: 2, limit: 100 })

    expect(out).toEqual({ embedded: 0, failed: 2, stoppedAtDeadline: false })
    expect(mockMissing).toHaveBeenCalledTimes(1)
  })
})

describe('backfillTaskTitleEmbeddings — deadline (LUM-1286)', () => {
  it('stops the one-by-one retries at the deadline and leaves the rest untried', async () => {
    const deadline = new Date(Date.now() + 60_000)
    mockMissing.mockResolvedValue([
      { id: 'a', title: 'A', createdAt: new Date(3) },
      { id: 'b', title: 'B', createdAt: new Date(2) },
      { id: 'c', title: 'C', createdAt: new Date(1) },
    ])
    mockEmbed
      .mockRejectedValueOnce(new Error('batch timed out'))
      .mockImplementationOnce(async () => {
        deadline.setTime(Date.now() - 1) // the budget runs out during "A"
        return [[1]]
      })

    const out = await backfillTaskTitleEmbeddings({
      batchSize: 3,
      limit: 100,
      deadline,
    })

    expect(out).toEqual({ embedded: 1, failed: 0, stoppedAtDeadline: true })
    expect(mockEmbed).toHaveBeenCalledTimes(2)
    expect(mockSet).toHaveBeenCalledWith('a', [1])
    expect(mockLogError).not.toHaveBeenCalled()
  })

  it('stops between batches once the deadline has passed', async () => {
    mockMissing.mockResolvedValue([{ id: 'a', title: 'A' }])
    mockEmbed.mockImplementation(async (xs: string[]) => xs.map(() => [1]))

    const out = await backfillTaskTitleEmbeddings({
      batchSize: 1,
      limit: 100,
      deadline: new Date(Date.now() - 1),
    })

    expect(out).toEqual({ embedded: 0, failed: 0, stoppedAtDeadline: true })
    expect(mockMissing).not.toHaveBeenCalled()
  })
})

describe('runTaskTitleEmbeddingBackfill (LUM-1286)', () => {
  it('reports what was missing, what it embedded and what is left', async () => {
    mockCount.mockResolvedValueOnce(2).mockResolvedValueOnce(0)
    mockMissing
      .mockResolvedValueOnce([
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ])
      .mockResolvedValueOnce([])
    mockEmbed.mockImplementation(async (xs: string[]) => xs.map(() => [1]))

    const out = await runTaskTitleEmbeddingBackfill({
      dryRun: false,
      deadline: new Date(Date.now() + 60_000),
    })

    expect(out).toEqual({
      dryRun: false,
      missingBefore: 2,
      embedded: 2,
      failed: 0,
      missingAfter: 0,
      stoppedAtDeadline: false,
    })
  })

  it('only counts on a dry run', async () => {
    mockCount.mockResolvedValue(7)

    const out = await runTaskTitleEmbeddingBackfill({
      dryRun: true,
      deadline: new Date(Date.now() + 60_000),
    })

    expect(out).toMatchObject({ dryRun: true, missingBefore: 7, embedded: 0, missingAfter: 7 })
    expect(mockEmbed).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
  })
})
