/**
 * @jest-environment node
 *
 * Tests for layer1OperationSchema discriminated union, including the SUPERSEDE
 * variant added in LUM-324. We mock the AI SDK gateway to prevent
 * TransformStream errors — only the Zod schema is exercised here.
 */
jest.mock('@/lib/ai/gateway', () => ({ gateway: jest.fn() }))
jest.mock('ai', () => ({ generateObject: jest.fn() }))

import { layer1OperationSchema } from '@/lib/services/memory/layer1-extract'

describe('layer1OperationSchema SUPERSEDE', () => {
  it('accepts a SUPERSEDE op with id + content', () => {
    const parsed = layer1OperationSchema.parse({
      type: 'SUPERSEDE',
      id: 'mem_old',
      content: { rule: 'new rule', scope: 'all' },
    })
    expect(parsed).toEqual({
      type: 'SUPERSEDE',
      id: 'mem_old',
      content: { rule: 'new rule', scope: 'all' },
    })
  })

  it('rejects a SUPERSEDE op missing id', () => {
    expect(() =>
      layer1OperationSchema.parse({ type: 'SUPERSEDE', content: {} })
    ).toThrow()
  })

  it('still accepts ADD / UPDATE / DELETE / NOOP', () => {
    expect(() => layer1OperationSchema.parse({ type: 'NOOP' })).not.toThrow()
    expect(() =>
      layer1OperationSchema.parse({ type: 'DELETE', id: 'x' })
    ).not.toThrow()
  })
})
