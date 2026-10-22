/**
 * @jest-environment node
 */

jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: jest.fn(() => 'model') }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: {
    findForDuplicateCheck: jest.fn(),
    findNearestByTitleEmbedding: jest.fn(),
    findForDuplicateCheckByIds: jest.fn(),
  },
}))
jest.mock('@/lib/ai/embedding', () => ({ embedTexts: jest.fn() }))
jest.mock('@/lib/repositories/task-dependency.repository', () => ({
  taskDependencyRepository: { createManySuggested: jest.fn() },
}))
jest.mock('@/lib/auth/user-batch', () => ({ listUsersByIds: jest.fn() }))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { generateObject } from 'ai'
import { embedTexts } from '@/lib/ai/embedding'
import { taskRepository } from '@/lib/repositories'
import { taskDependencyRepository } from '@/lib/repositories/task-dependency.repository'
import {
  CLI_BIGRAM_FALLBACK_CANDIDATES,
  DUPLICATE_SUGGEST_SCORE,
  CLI_DUPLICATE_CANDIDATES,
  checkDuplicates,
  findLikelyDuplicates,
  suggestDuplicateEdges,
} from '@/lib/services/duplicate-check.service'

const mockGenerate = generateObject as jest.Mock
const mockFind = taskRepository.findForDuplicateCheck as jest.Mock
const mockEmbed = embedTexts as jest.Mock
const mockNearest = taskRepository.findNearestByTitleEmbedding as jest.Mock
const mockByIds = taskRepository.findForDuplicateCheckByIds as jest.Mock

function task(id: string, title: string, number: number) {
  return {
    id,
    title,
    number,
    status: 'TODO',
    priority: 'LOW',
    team: { identifier: 'LUM' },
    assignee: null,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  // Default: embedding recall unavailable, so the bigram prefilter runs.
  mockEmbed.mockRejectedValue(new Error('no gateway in tests'))
  mockNearest.mockResolvedValue([])
  mockByIds.mockResolvedValue([])
  mockFind.mockResolvedValue([
    task('t-1', 'Add Google OAuth login', 12),
    task('t-2', 'Login page copy tweaks', 13),
  ])
})

describe('findLikelyDuplicates (LUM-1286)', () => {
  it('keeps only matches at or above the CLI block score', async () => {
    mockGenerate.mockResolvedValue({
      object: {
        matches: [
          { taskId: 't-1', score: 0.92 },
          { taskId: 't-2', score: DUPLICATE_SUGGEST_SCORE - 0.1 },
        ],
      },
    })

    const result = await findLikelyDuplicates('Google OAuth sign-in', 'p-1')

    expect(result.map(m => m.taskId)).toEqual(['t-1'])
    expect(result[0]).toMatchObject({
      number: 12,
      teamIdentifier: 'LUM',
      title: 'Add Google OAuth login',
    })
  })

  it('fails open: an LLM error yields no matches instead of throwing', async () => {
    mockGenerate.mockRejectedValue(new Error('gateway down'))

    await expect(
      findLikelyDuplicates('Google OAuth sign-in', 'p-1')
    ).resolves.toEqual([])
  })

  it('bounds the LLM call with an abort signal', async () => {
    mockGenerate.mockResolvedValue({ object: { matches: [] } })

    await findLikelyDuplicates('Google OAuth sign-in', 'p-1')

    const [args] = mockGenerate.mock.calls[0]!
    expect(args.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('bounds the whole check, not just the LLM call', async () => {
    mockFind.mockReturnValue(new Promise(() => {}))

    await expect(
      findLikelyDuplicates('Google OAuth sign-in', 'p-1', { timeoutMs: 50 })
    ).resolves.toEqual([])
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('skips the LLM when the project has no tasks', async () => {
    mockFind.mockResolvedValue([])

    await expect(findLikelyDuplicates('anything', 'p-1')).resolves.toEqual([])
    expect(mockGenerate).not.toHaveBeenCalled()
  })
})

describe('checkDuplicates candidateLimit prefilter (LUM-1286)', () => {
  it('sends only the N titles closest by bigram similarity to the LLM', async () => {
    const filler = Array.from({ length: 30 }, (_, i) =>
      task(`f-${i}`, `Refactor billing webhook ${i}`, 100 + i)
    )
    mockFind.mockResolvedValue([
      ...filler,
      task('t-1', 'Add Google OAuth login', 12),
    ])
    mockGenerate.mockResolvedValue({ object: { matches: [] } })

    await checkDuplicates('Google OAuth sign-in', 'p-1', {
      candidateLimit: CLI_DUPLICATE_CANDIDATES,
    })

    const prompt: string = mockGenerate.mock.calls[0]![0].prompt
    const listed = prompt.match(/^(t|f)-\d+: /gm) ?? []
    expect(listed).toHaveLength(CLI_BIGRAM_FALLBACK_CANDIDATES)
    expect(prompt).toContain('t-1: Add Google OAuth login')
  })

  it('sends every title when no limit is given (web path unchanged)', async () => {
    const filler = Array.from({ length: 30 }, (_, i) =>
      task(`f-${i}`, `Refactor billing webhook ${i}`, 100 + i)
    )
    mockFind.mockResolvedValue(filler)
    mockGenerate.mockResolvedValue({ object: { matches: [] } })

    await checkDuplicates('Google OAuth sign-in', 'p-1')

    const prompt: string = mockGenerate.mock.calls[0]![0].prompt
    expect(prompt.match(/^f-\d+: /gm)).toHaveLength(30)
  })
})

describe('checkDuplicates embedding recall (LUM-1286 step 2)', () => {
  const listed = (prompt: string) =>
    (prompt.match(/^[a-z]+-\d+: /gm) ?? []).map(l => l.slice(0, -2))

  it('sends the project-wide nearest titles plus the top bigram hits from recent tasks', async () => {
    const recent = Array.from({ length: 30 }, (_, i) =>
      task(`r-${i}`, `Refactor billing webhook ${i}`, 100 + i)
    )
    recent.push(task('r-99', 'Google OAuth sign in button', 199))
    mockFind.mockResolvedValue(recent)
    mockEmbed.mockResolvedValue([[0.1, 0.2]])
    mockNearest.mockResolvedValue(['old-1', 'old-2'])
    mockByIds.mockResolvedValue([
      task('old-1', 'Login with Google account', 7),
      task('old-2', 'Support SSO providers', 8),
    ])
    mockGenerate.mockResolvedValue({ object: { matches: [] } })

    await checkDuplicates('Google OAuth sign-in', 'p-1', {
      candidateLimit: CLI_DUPLICATE_CANDIDATES,
    })

    expect(mockEmbed).toHaveBeenCalledWith(['Google OAuth sign-in'])
    expect(mockNearest).toHaveBeenCalledWith(
      'p-1',
      [0.1, 0.2],
      CLI_DUPLICATE_CANDIDATES
    )
    const ids = listed(mockGenerate.mock.calls[0]![0].prompt)
    expect(ids.slice(0, 2)).toEqual(['old-1', 'old-2'])
    expect(ids).toContain('r-99')
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeLessThanOrEqual(CLI_DUPLICATE_CANDIDATES + 3)
  })

  it('falls back to the bigram prefilter when the project has no embeddings yet', async () => {
    mockFind.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => task(`r-${i}`, `Task ${i}`, i))
    )
    mockEmbed.mockResolvedValue([[0.1, 0.2]])
    mockNearest.mockResolvedValue([])
    mockGenerate.mockResolvedValue({ object: { matches: [] } })

    await checkDuplicates('Task 3', 'p-1', {
      candidateLimit: CLI_DUPLICATE_CANDIDATES,
    })

    expect(listed(mockGenerate.mock.calls[0]![0].prompt)).toHaveLength(
      CLI_BIGRAM_FALLBACK_CANDIDATES
    )
    expect(mockByIds).not.toHaveBeenCalled()
  })

  it('falls back to the bigram prefilter when embedding the title fails', async () => {
    mockFind.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => task(`r-${i}`, `Task ${i}`, i))
    )
    mockGenerate.mockResolvedValue({ object: { matches: [] } })

    await checkDuplicates('Task 3', 'p-1', {
      candidateLimit: CLI_DUPLICATE_CANDIDATES,
    })

    expect(listed(mockGenerate.mock.calls[0]![0].prompt)).toHaveLength(
      CLI_BIGRAM_FALLBACK_CANDIDATES
    )
    expect(mockNearest).not.toHaveBeenCalled()
  })

  it('leaves the web path (no candidateLimit) on the recent-200 titles', async () => {
    mockFind.mockResolvedValue([task('r-1', 'A', 1)])
    mockGenerate.mockResolvedValue({ object: { matches: [] } })

    await checkDuplicates('A', 'p-1')

    expect(mockEmbed).not.toHaveBeenCalled()
  })
})

describe('findLikelyDuplicates excludes the task being checked (LUM-1286)', () => {
  it('drops the new task itself from the matches', async () => {
    mockGenerate.mockResolvedValue({
      object: {
        matches: [
          { taskId: 't-1', score: 0.9 },
          { taskId: 't-2', score: 1 },
        ],
      },
    })

    const out = await findLikelyDuplicates('Add Google OAuth login', 'p-1', {
      excludeTaskId: 't-2',
    })

    expect(out.map(m => m.taskId)).toEqual(['t-1'])
  })
})

describe('suggestDuplicateEdges (LUM-1286)', () => {
  const mockCreate = taskDependencyRepository.createManySuggested as jest.Mock

  it('records each likely duplicate as a suggested DUPLICATES edge from the new task', async () => {
    mockGenerate.mockResolvedValue({
      object: { matches: [{ taskId: 't-1', score: 0.92 }] },
    })

    await suggestDuplicateEdges({
      taskId: 'new-1',
      title: 'Sign in with Google',
      projectId: 'p-1',
      workspaceId: 'ws-1',
    })

    expect(mockCreate).toHaveBeenCalledWith([
      {
        workspaceId: 'ws-1',
        blockedTaskId: 'new-1',
        blockingTaskId: 't-1',
        kind: 'DUPLICATES',
        reason: 'possible_duplicate',
        detail: { score: 0.92 },
      },
    ])
  })

  it('writes nothing when no candidate clears the score', async () => {
    mockGenerate.mockResolvedValue({
      object: { matches: [{ taskId: 't-1', score: 0.5 }] },
    })

    await suggestDuplicateEdges({
      taskId: 'new-1',
      title: 'x',
      projectId: 'p-1',
      workspaceId: 'ws-1',
    })

    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('never throws, even when writing the edges fails', async () => {
    mockGenerate.mockResolvedValue({
      object: { matches: [{ taskId: 't-1', score: 0.9 }] },
    })
    mockCreate.mockRejectedValueOnce(new Error('db down'))

    await expect(
      suggestDuplicateEdges({
        taskId: 'new-1',
        title: 'x',
        projectId: 'p-1',
        workspaceId: 'ws-1',
      })
    ).resolves.toBeUndefined()
  })
})
