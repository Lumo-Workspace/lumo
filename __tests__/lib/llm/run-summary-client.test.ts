jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@ai-sdk/gateway', () => ({
  gateway: jest.fn().mockReturnValue('mocked-model'),
}))

import { generateObject } from 'ai'
import { callRunSummaryLLM } from '@/lib/llm/run-summary-client'

const mockGenerateObject = generateObject as jest.MockedFunction<
  typeof generateObject
>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('callRunSummaryLLM', () => {
  it('returns object.summary from generateObject', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { summary: 'did X, Y, Z' },
    } as any)

    const result = await callRunSummaryLLM({
      taskTitle: 'T',
      turnSummaries: ['a', 'b'],
    })

    expect(result).toBe('did X, Y, Z')
  })

  it('includes the task title and numbered turn notes in the prompt', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { summary: 'ok' },
    } as any)

    await callRunSummaryLLM({
      taskTitle: 'My Task',
      turnSummaries: ['first note', 'second note'],
    })

    const arg = mockGenerateObject.mock.calls[0]![0] as any
    expect(arg.prompt).toContain('My Task')
    expect(arg.prompt).toContain('first note')
    expect(arg.prompt).toContain('second note')
    expect(arg.prompt).toContain('1.')
    expect(arg.prompt).toContain('2.')
  })
})
