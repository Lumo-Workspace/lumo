/**
 * @jest-environment node
 */

jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({ gateway: jest.fn(() => 'model') }))
jest.mock('@/lib/repositories', () => ({
  taskRepository: { findForDuplicateCheck: jest.fn() },
}))
jest.mock('@/lib/auth/user-batch', () => ({ listUsersByIds: jest.fn() }))
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}))

import { generateObject } from 'ai'
import { taskRepository } from '@/lib/repositories'
import {
  CLI_DUPLICATE_BLOCK_SCORE,
  CLI_DUPLICATE_CANDIDATES,
  checkDuplicates,
  findBlockingDuplicates,
} from '@/lib/services/duplicate-check.service'

const mockGenerate = generateObject as jest.Mock
const mockFind = taskRepository.findForDuplicateCheck as jest.Mock

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
  mockFind.mockResolvedValue([
    task('t-1', 'Add Google OAuth login', 12),
    task('t-2', 'Login page copy tweaks', 13),
  ])
})

describe('findBlockingDuplicates (LUM-1286)', () => {
  it('keeps only matches at or above the CLI block score', async () => {
    mockGenerate.mockResolvedValue({
      object: {
        matches: [
          { taskId: 't-1', score: 0.92 },
          { taskId: 't-2', score: CLI_DUPLICATE_BLOCK_SCORE - 0.1 },
        ],
      },
    })

    const result = await findBlockingDuplicates('Google OAuth sign-in', 'p-1')

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
      findBlockingDuplicates('Google OAuth sign-in', 'p-1')
    ).resolves.toEqual([])
  })

  it('bounds the LLM call with an abort signal', async () => {
    mockGenerate.mockResolvedValue({ object: { matches: [] } })

    await findBlockingDuplicates('Google OAuth sign-in', 'p-1')

    const [args] = mockGenerate.mock.calls[0]!
    expect(args.abortSignal).toBeInstanceOf(AbortSignal)
  })

  it('bounds the whole check, not just the LLM call', async () => {
    mockFind.mockReturnValue(new Promise(() => {}))

    await expect(
      findBlockingDuplicates('Google OAuth sign-in', 'p-1', 50)
    ).resolves.toEqual([])
    expect(mockGenerate).not.toHaveBeenCalled()
  })

  it('skips the LLM when the project has no tasks', async () => {
    mockFind.mockResolvedValue([])

    await expect(findBlockingDuplicates('anything', 'p-1')).resolves.toEqual([])
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
    expect(listed).toHaveLength(CLI_DUPLICATE_CANDIDATES)
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
