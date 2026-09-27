const mockRetrieve = jest.fn()
jest.mock('@/lib/services/memory/embedding-neighbor-retriever', () => ({
  compositeNeighborRetriever: { retrieve: (...a: any[]) => mockRetrieve(...a) },
}))
const mockGenerateObject = jest.fn()
jest.mock('ai', () => ({
  generateObject: (...a: any[]) => mockGenerateObject(...a),
}))
jest.mock('@/lib/ai/gateway', () => ({ gateway: (id: string) => ({ id }) }))

import { resolveManualDedup } from '@/lib/services/memory/manual-dedup'

const baseInput = () => ({
  category: 'TRAP' as const,
  content: { trigger: 'x', outcome: 'y' },
  candidateText: 'x y',
  candidateVector: [0.1, 0.2] as number[] | undefined,
  pool: [
    {
      id: 'n1',
      category: 'TRAP' as const,
      content: { trigger: 'x2', outcome: 'y2' },
    },
  ],
  scope: { kind: 'PROJECT' as const, projectId: 'p1' },
})

beforeEach(() => {
  jest.clearAllMocks()
})

it('no neighbors → ADD (no LLM call)', async () => {
  mockRetrieve.mockResolvedValue([])
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'ADD' })
  expect(mockGenerateObject).not.toHaveBeenCalled()
})

it('neighbor + reconcile NOOP → NOOP referencing the top neighbor id', async () => {
  mockRetrieve.mockResolvedValue([
    { id: 'n1', category: 'TRAP', content: {}, score: 0.9 },
  ])
  mockGenerateObject.mockResolvedValue({
    object: { operations: [{ type: 'NOOP' }] },
  })
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'NOOP', id: 'n1' })
})

it('neighbor + reconcile UPDATE → UPDATE with validated content', async () => {
  mockRetrieve.mockResolvedValue([
    { id: 'n1', category: 'TRAP', content: {}, score: 0.9 },
  ])
  mockGenerateObject.mockResolvedValue({
    object: {
      operations: [
        {
          type: 'UPDATE',
          id: 'n1',
          content: { trigger: 'merged', outcome: 'merged out' },
        },
      ],
    },
  })
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({
    kind: 'UPDATE',
    id: 'n1',
    content: { trigger: 'merged', outcome: 'merged out' },
  })
})

it('reconcile SUPERSEDE → SUPERSEDE', async () => {
  mockRetrieve.mockResolvedValue([
    { id: 'n1', category: 'TRAP', content: {}, score: 0.9 },
  ])
  mockGenerateObject.mockResolvedValue({
    object: {
      operations: [
        {
          type: 'SUPERSEDE',
          id: 'n1',
          content: { trigger: 't', outcome: 'o' },
        },
      ],
    },
  })
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({
    kind: 'SUPERSEDE',
    id: 'n1',
    content: { trigger: 't', outcome: 'o' },
  })
})

it('UPDATE targeting an id NOT among neighbors → ADD (fail-open)', async () => {
  mockRetrieve.mockResolvedValue([
    { id: 'n1', category: 'TRAP', content: {}, score: 0.9 },
  ])
  mockGenerateObject.mockResolvedValue({
    object: {
      operations: [
        {
          type: 'UPDATE',
          id: 'GHOST',
          content: { trigger: 't', outcome: 'o' },
        },
      ],
    },
  })
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'ADD' })
})

it('UPDATE whose content fails the category schema → ADD (fail-open)', async () => {
  mockRetrieve.mockResolvedValue([
    { id: 'n1', category: 'TRAP', content: {}, score: 0.9 },
  ])
  mockGenerateObject.mockResolvedValue({
    object: {
      operations: [{ type: 'UPDATE', id: 'n1', content: { trigger: 'only' } }],
    },
  })
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'ADD' })
})

it('SUPERSEDE whose content fails the category schema → ADD (fail-open)', async () => {
  mockRetrieve.mockResolvedValue([
    { id: 'n1', category: 'TRAP', content: {}, score: 0.9 },
  ])
  mockGenerateObject.mockResolvedValue({
    object: {
      operations: [
        { type: 'SUPERSEDE', id: 'n1', content: { trigger: 'only' } },
      ],
    },
  })
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'ADD' })
})

it('reconcile throws → ADD (fail-open)', async () => {
  mockRetrieve.mockResolvedValue([
    { id: 'n1', category: 'TRAP', content: {}, score: 0.9 },
  ])
  mockGenerateObject.mockRejectedValue(new Error('gateway down'))
  const r = await resolveManualDedup(baseInput())
  expect(r).toEqual({ kind: 'ADD' })
})
