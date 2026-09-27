const generateObjectMock = jest.fn()
jest.mock('ai', () => ({
  generateObject: (...a: unknown[]) => generateObjectMock(...a),
}))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import { reconcileLayer2Candidates } from '@/lib/services/memory/layer2-extract'

beforeEach(() => {
  generateObjectMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('reconcileLayer2Candidates', () => {
  it('returns operations and forwards neighbor ids into the prompt', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        operations: [
          { type: 'UPDATE', id: 'pm_old', content: { rule: 'r', scope: 's' } },
        ],
      },
    })
    const ops = await reconcileLayer2Candidates({
      project: { id: 'p1', name: 'P' },
      candidates: [
        {
          category: 'CONVENTION',
          content: { rule: 'r2', scope: 's2' },
          sourceMemoryIds: ['tm_1'],
        },
      ],
      neighborsByCandidate: [
        [
          {
            id: 'pm_old',
            category: 'CONVENTION',
            content: { rule: 'r', scope: 's' },
            score: 0.7,
          },
        ],
      ],
    })
    expect(ops).toEqual([
      { type: 'UPDATE', id: 'pm_old', content: { rule: 'r', scope: 's' } },
    ])
    const callArg = generateObjectMock.mock.calls[0]![0] as { prompt: string }
    expect(callArg.prompt).toContain('pm_old')
  })

  it('degrades to [] on model error', async () => {
    generateObjectMock.mockRejectedValue(new Error('down'))
    expect(
      await reconcileLayer2Candidates({
        project: { id: 'p1', name: 'P' },
        candidates: [],
        neighborsByCandidate: [],
      })
    ).toEqual([])
  })

  // LUM-335: same schema-drift resilience as layer1 — `operation`-keyed alias is
  // recovered and a single garbage element is dropped without losing the batch.
  it('recovers an `operation`-keyed op and drops only the garbage element', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        operations: [
          { operation: 'SUPERSEDE', id: 'pm_old', content: { rule: 'r' } },
          { junk: true },
          { type: 'NOOP' },
        ],
      },
    })
    const ops = await reconcileLayer2Candidates({
      project: { id: 'p1', name: 'P' },
      candidates: [],
      neighborsByCandidate: [],
    })
    expect(ops).toEqual([
      { type: 'SUPERSEDE', id: 'pm_old', content: { rule: 'r' } },
      { type: 'NOOP' },
    ])
  })
})
