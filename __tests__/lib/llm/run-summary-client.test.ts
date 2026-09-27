jest.mock('ai', () => ({ generateObject: jest.fn() }))
jest.mock('@/lib/ai/gateway', () => ({
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
      eventLog: '[00:00:01] Edit /a.ts +2 -1',
    })

    expect(result).toBe('did X, Y, Z')
  })

  it('includes the task title and the compacted event log in the prompt', async () => {
    mockGenerateObject.mockResolvedValueOnce({
      object: { summary: 'ok' },
    } as any)

    await callRunSummaryLLM({
      taskTitle: 'My Task',
      eventLog:
        '[00:00:01] Read /x.ts (10 lines)\n[00:00:02] Write /y.ts (text, 5 lines)',
    })

    const arg = mockGenerateObject.mock.calls[0]![0] as any
    expect(arg.prompt).toContain('My Task')
    expect(arg.prompt).toContain('Read /x.ts')
    expect(arg.prompt).toContain('Write /y.ts')
  })
})
