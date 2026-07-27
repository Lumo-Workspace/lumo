/**
 * @jest-environment node
 */
import { layer2OperationSchema } from '@/lib/services/memory/layer2-extract'

describe('layer2OperationSchema ADD sourceMemoryIds', () => {
  it('accepts an ADD with sourceMemoryIds', () => {
    const parsed = layer2OperationSchema.parse({
      type: 'ADD',
      category: 'TRAP',
      content: { trigger: 't', outcome: 'o' },
      sourceMemoryIds: ['mem_1', 'mem_2'],
    })
    expect(parsed).toMatchObject({ sourceMemoryIds: ['mem_1', 'mem_2'] })
  })

  it('accepts an ADD without sourceMemoryIds (optional)', () => {
    const parsed = layer2OperationSchema.parse({
      type: 'ADD',
      category: 'TRAP',
      content: { trigger: 't', outcome: 'o' },
    })
    expect(parsed.type).toBe('ADD')
    expect(
      (parsed as { sourceMemoryIds?: string[] }).sourceMemoryIds
    ).toBeUndefined()
  })

  it('accepts a SUPERSEDE op with id + content', () => {
    expect(() =>
      layer2OperationSchema.parse({
        type: 'SUPERSEDE',
        id: 'mem_old',
        content: { rule: 'r', scope: 's' },
      })
    ).not.toThrow()
  })

  it('still rejects DELETE (Layer 2 has no hard delete)', () => {
    expect(() =>
      layer2OperationSchema.parse({ type: 'DELETE', id: 'x' })
    ).toThrow()
  })
})
