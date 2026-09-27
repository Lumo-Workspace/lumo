const generateObjectMock = jest.fn()
jest.mock('ai', () => ({
  generateObject: (...a: unknown[]) => generateObjectMock(...a),
}))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import { reconcileLayer1Candidates } from '@/lib/services/memory/layer1-extract'

const task = { id: 'task_1', title: 'T', description: null }

beforeEach(() => {
  generateObjectMock.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('reconcileLayer1Candidates', () => {
  it('passes candidates + neighbors to the model and returns its operations', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        operations: [
          {
            type: 'SUPERSEDE',
            id: 'mem_old',
            content: { rule: 'r', scope: 's' },
          },
        ],
      },
    })
    const ops = await reconcileLayer1Candidates({
      task,
      candidates: [
        { category: 'CONVENTION', content: { rule: 'r2', scope: 's2' } },
      ],
      neighborsByCandidate: [
        [
          {
            id: 'mem_old',
            category: 'CONVENTION',
            content: { rule: 'r', scope: 's' },
            score: 0.8,
          },
        ],
      ],
    })
    expect(ops).toEqual([
      { type: 'SUPERSEDE', id: 'mem_old', content: { rule: 'r', scope: 's' } },
    ])
    const callArg = generateObjectMock.mock.calls[0]![0] as { prompt: string }
    expect(callArg.prompt).toContain('mem_old')
  })

  it('degrades to [] on model error', async () => {
    generateObjectMock.mockRejectedValue(new Error('down'))
    const ops = await reconcileLayer1Candidates({
      task,
      candidates: [],
      neighborsByCandidate: [],
    })
    expect(ops).toEqual([])
  })

  // LUM-335: the model occasionally keys an element `{"operation":...}` instead
  // of the `{"type":...}` discriminator, or emits one malformed element. The
  // old strict-array path threw inside generateObject and the catch dropped the
  // WHOLE turn. Now generateObject gets a LOOSE array schema and each element is
  // validated individually — alias recovered, garbage dropped, rest survives.
  it('recovers an `operation`-keyed op and drops only the garbage element (no whole-batch loss)', async () => {
    generateObjectMock.mockResolvedValue({
      object: {
        operations: [
          { operation: 'SUPERSEDE', id: 'mem_old', content: { rule: 'r' } },
          { not: 'an op' },
          { type: 'UPDATE', id: 'mem_b', content: { rule: 'r2' } },
        ],
      },
    })
    const ops = await reconcileLayer1Candidates({
      task,
      candidates: [],
      neighborsByCandidate: [],
    })
    expect(ops).toEqual([
      { type: 'SUPERSEDE', id: 'mem_old', content: { rule: 'r' } },
      { type: 'UPDATE', id: 'mem_b', content: { rule: 'r2' } },
    ])
  })
})
