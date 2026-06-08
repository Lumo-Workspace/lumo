const generateObjectMock = jest.fn()
jest.mock('ai', () => ({ generateObject: (...a: unknown[]) => generateObjectMock(...a) }))
jest.mock('@ai-sdk/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import {
  extractLayer1Candidates,
  layer1CandidatesOutputSchema,
} from '@/lib/services/memory/layer1-extract'

const baseInput = {
  task: { id: 'task_1', title: 'T', description: null, projectId: 'p1', workspaceId: 'w1' },
  turnEvents: [],
  existingMemories: [],
} as const

beforeEach(() => {
  generateObjectMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('extractLayer1Candidates', () => {
  it('returns the model candidates list', async () => {
    generateObjectMock.mockResolvedValue({
      object: { candidates: [{ category: 'TRAP', content: { trigger: 'x', outcome: 'y' } }] },
    })
    const out = await extractLayer1Candidates(baseInput)
    expect(out).toEqual([{ category: 'TRAP', content: { trigger: 'x', outcome: 'y' } }])
  })

  it('degrades to [] when the model call throws', async () => {
    generateObjectMock.mockRejectedValue(new Error('gateway down'))
    expect(await extractLayer1Candidates(baseInput)).toEqual([])
  })

  it('candidate schema accepts optional scope', () => {
    expect(() =>
      layer1CandidatesOutputSchema.parse({
        candidates: [{ category: 'CONVENTION', scope: 'PROJECT', content: { rule: 'r', scope: 's' } }],
      })
    ).not.toThrow()
  })
})
