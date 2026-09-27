const generateObjectMock = jest.fn()
jest.mock('ai', () => ({
  generateObject: (...a: unknown[]) => generateObjectMock(...a),
}))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import {
  extractLayer2Candidates,
  layer2CandidatesOutputSchema,
} from '@/lib/services/memory/layer2-extract'

const input = {
  project: { id: 'p1', name: 'P', workspaceId: 'w1' },
  taskMemories: [
    {
      id: 'tm_1',
      taskId: 't1',
      category: 'TRAP' as const,
      content: { trigger: 'x', outcome: 'y' },
    },
  ],
  existingProjectMemories: [],
  constitution: { claudeMd: null, agentsMd: null },
}

beforeEach(() => {
  generateObjectMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('extractLayer2Candidates', () => {
  it('returns model candidates incl. sourceMemoryIds', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        candidates: [
          {
            category: 'TRAP',
            content: { trigger: 'x', outcome: 'y' },
            sourceMemoryIds: ['tm_1'],
          },
        ],
      },
    })
    const out = await extractLayer2Candidates(input)
    expect(out[0]!.sourceMemoryIds).toEqual(['tm_1'])
  })

  it('degrades to [] on model error', async () => {
    generateObjectMock.mockRejectedValue(new Error('down'))
    expect(await extractLayer2Candidates(input)).toEqual([])
  })

  it('candidate schema allows omitting sourceMemoryIds', () => {
    expect(() =>
      layer2CandidatesOutputSchema.parse({
        candidates: [
          { category: 'CONVENTION', content: { rule: 'r', scope: 's' } },
        ],
      })
    ).not.toThrow()
  })
})
