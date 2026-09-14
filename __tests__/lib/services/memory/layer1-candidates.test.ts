const generateObjectMock = jest.fn()
jest.mock('ai', () => ({
  generateObject: (...a: unknown[]) => generateObjectMock(...a),
}))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import {
  extractLayer1Turn,
  layer1TurnOutputSchema,
} from '@/lib/services/memory/layer1-extract'

const baseInput = {
  task: {
    id: 'task_1',
    title: 'T',
    description: null,
    projectId: 'p1',
    workspaceId: 'w1',
  },
  turnEvents: [],
  existingMemories: [],
}

beforeEach(() => {
  generateObjectMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('extractLayer1Turn — one call yields the turn summary AND the candidates (LUM-773)', () => {
  it('makes exactly one model call and returns both the summary and the candidates', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        turnSummary: '运行 prisma migrate，P3009 报错',
        candidates: [
          {
            category: 'TRAP',
            content: { trigger: 'x', outcome: 'y' },
            quote: 'P3009',
          },
        ],
      },
    })
    const out = await extractLayer1Turn(baseInput)
    expect(generateObjectMock).toHaveBeenCalledTimes(1)
    expect(out.summary).toBe('运行 prisma migrate，P3009 报错')
    expect(out.candidates).toEqual([
      {
        category: 'TRAP',
        content: { trigger: 'x', outcome: 'y' },
        quote: 'P3009',
      },
    ])
  })

  it('runs the summary through cleanTurnSummary: meta-reasoning becomes null, candidates survive', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        turnSummary: '我们被要求总结这一回合做了什么',
        candidates: [
          { category: 'TRAP', content: { trigger: 'x', outcome: 'y' } },
        ],
      },
    })
    const out = await extractLayer1Turn(baseInput)
    expect(out.summary).toBeNull()
    expect(out.candidates).toHaveLength(1)
  })

  it('normalises a blank summary to null', async () => {
    generateObjectMock.mockResolvedValue({
      object: { turnSummary: '   ', candidates: [] },
    })
    const out = await extractLayer1Turn(baseInput)
    expect(out.summary).toBeNull()
  })

  it('degrades to { summary: null, candidates: [] } when the model call throws', async () => {
    generateObjectMock.mockRejectedValue(new Error('gateway down'))
    expect(await extractLayer1Turn(baseInput)).toEqual({
      summary: null,
      candidates: [],
    })
  })

  it('output schema accepts optional scope and optional quote on a candidate', () => {
    expect(() =>
      layer1TurnOutputSchema.parse({
        turnSummary: '读了 X',
        candidates: [
          {
            category: 'CONVENTION',
            scope: 'PROJECT',
            content: { rule: 'r', scope: 's' },
            quote: 'all new schemas use Zod',
          },
          { category: 'TRAP', content: { trigger: 't', outcome: 'o' } },
        ],
      })
    ).not.toThrow()
  })
})
