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
    expect((parsed as { sourceMemoryIds?: string[] }).sourceMemoryIds).toBeUndefined()
  })
})
