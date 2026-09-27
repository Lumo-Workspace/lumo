/**
 * @jest-environment node
 *
 * LUM-335: per-op resilient parsing for the reconcile pass. The reconcile LLM
 * (deepseek-v4-flash) intermittently (a) keys an op element `{"operation":...}`
 * instead of the `{"type":...}` discriminator the Zod schema expects, and
 * (b) emits one malformed element in an otherwise-valid batch. The old strict
 * `generateObject(schema=discriminatedUnion[])` path threw on the first bad
 * element and the catch dropped the WHOLE turn's writes.
 *
 * These tests pin the recovery contract: `operation`→`type` aliasing, and
 * batch parsing that drops only the bad elements. The AI SDK gateway is mocked
 * to dodge the TransformStream jest trap (schema is all we exercise here).
 */
jest.mock('@/lib/ai/gateway', () => ({ gateway: jest.fn() }))
jest.mock('ai', () => ({ generateObject: jest.fn() }))

import {
  coerceReconcileOperation,
  parseReconcileOperations,
} from '@/lib/services/memory/reconcile-parse'
import { layer1OperationSchema } from '@/lib/services/memory/layer1-extract'
import { layer2OperationSchema } from '@/lib/services/memory/layer2-extract'

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('coerceReconcileOperation', () => {
  it('recovers an `operation`-keyed SUPERSEDE element via alias (layer1)', () => {
    const op = coerceReconcileOperation(
      { operation: 'SUPERSEDE', id: 'mem_old', content: { rule: 'r' } },
      layer1OperationSchema
    )
    expect(op).toEqual({
      type: 'SUPERSEDE',
      id: 'mem_old',
      content: { rule: 'r' },
    })
  })

  it('does not carry the stray `operation` key into the parsed op', () => {
    const op = coerceReconcileOperation(
      { operation: 'UPDATE', id: 'mem_x', content: { rule: 'r' } },
      layer1OperationSchema
    ) as Record<string, unknown> | null
    expect(op).not.toBeNull()
    expect(op).not.toHaveProperty('operation')
  })

  it('leaves a well-formed `type`-keyed op unchanged', () => {
    const raw = { type: 'NOOP' as const }
    expect(coerceReconcileOperation(raw, layer1OperationSchema)).toEqual({
      type: 'NOOP',
    })
  })

  it('prefers an explicit `type` over a stray `operation` when both present', () => {
    const op = coerceReconcileOperation(
      { type: 'NOOP', operation: 'SUPERSEDE' },
      layer1OperationSchema
    )
    expect(op).toEqual({ type: 'NOOP' })
  })

  it('returns null for a genuinely garbage element (no recoverable shape)', () => {
    expect(
      coerceReconcileOperation({ foo: 'bar' }, layer1OperationSchema)
    ).toBeNull()
    expect(coerceReconcileOperation(null, layer1OperationSchema)).toBeNull()
    expect(
      coerceReconcileOperation('SUPERSEDE', layer1OperationSchema)
    ).toBeNull()
  })

  it('also aliases for the layer2 op schema (no DELETE variant)', () => {
    const op = coerceReconcileOperation(
      { operation: 'ADD', category: 'CONVENTION', content: { rule: 'r' } },
      layer2OperationSchema
    )
    expect(op).toEqual({
      type: 'ADD',
      category: 'CONVENTION',
      content: { rule: 'r' },
    })
  })
})

describe('parseReconcileOperations', () => {
  it('drops only the bad element, keeping the surrounding valid ops', () => {
    const ops = parseReconcileOperations(
      [
        { type: 'SUPERSEDE', id: 'a', content: { rule: 'r1' } },
        { totally: 'garbage' },
        { type: 'UPDATE', id: 'b', content: { rule: 'r2' } },
      ],
      layer1OperationSchema,
      'memory.layer1'
    )
    expect(ops).toEqual([
      { type: 'SUPERSEDE', id: 'a', content: { rule: 'r1' } },
      { type: 'UPDATE', id: 'b', content: { rule: 'r2' } },
    ])
  })

  it('a malformed op no longer nukes the whole batch — alias + valid both survive', () => {
    const ops = parseReconcileOperations(
      [
        { operation: 'SUPERSEDE', id: 'a', content: { rule: 'r1' } },
        { type: 'NOOP' },
      ],
      layer1OperationSchema,
      'memory.layer1'
    )
    expect(ops).toEqual([
      { type: 'SUPERSEDE', id: 'a', content: { rule: 'r1' } },
      { type: 'NOOP' },
    ])
  })

  it('leaves a fully-valid `type`-keyed batch unchanged', () => {
    const batch = [
      {
        type: 'ADD',
        category: 'TRAP',
        content: { trigger: 't', outcome: 'o' },
      },
      { type: 'NOOP' },
      { type: 'DELETE', id: 'z' },
    ]
    const ops = parseReconcileOperations(
      batch,
      layer1OperationSchema,
      'memory.layer1'
    )
    expect(ops).toEqual(batch)
  })

  it('warns (naming the dropped op) when it discards an element', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    parseReconcileOperations(
      [{ type: 'UPDATE', id: 'b', content: { rule: 'r' } }, { junk: 1 }],
      layer1OperationSchema,
      'memory.layer1'
    )
    expect(warn).toHaveBeenCalled()
  })

  it('returns [] for a non-array input', () => {
    expect(
      parseReconcileOperations(
        undefined,
        layer1OperationSchema,
        'memory.layer1'
      )
    ).toEqual([])
  })
})
