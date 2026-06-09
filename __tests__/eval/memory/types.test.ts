import {
  relationshipToExpectedOp,
  validateEvalCase,
  isPositiveCase,
  type EvalCase,
} from '@/scripts/eval/memory/types'

const base: EvalCase = {
  id: 'trap-x-01',
  category: 'TRAP',
  existing: { trigger: 'a', outcome: 'b' },
  candidate: { trigger: 'a2', outcome: 'b2' },
  relationship: 'CONTRADICTION',
  expectedOp: 'SUPERSEDE',
}

describe('eval types', () => {
  it('maps each relationship to its op', () => {
    expect(relationshipToExpectedOp.CONTRADICTION).toBe('SUPERSEDE')
    expect(relationshipToExpectedOp.REFINEMENT).toBe('UPDATE')
    expect(relationshipToExpectedOp.DUPLICATE).toBe('NOOP')
    expect(relationshipToExpectedOp.UNRELATED).toBe('ADD')
  })

  it('validates a well-formed case', () => {
    expect(validateEvalCase(base)).toEqual([])
  })

  it('flags expectedOp that disagrees with relationship', () => {
    const bad = { ...base, expectedOp: 'NOOP' as const }
    expect(validateEvalCase(bad)).toContain(
      'trap-x-01: expectedOp NOOP != SUPERSEDE for relationship CONTRADICTION'
    )
  })

  it('flags duplicate ids across a list', () => {
    expect(validateEvalCase(base, new Set(['trap-x-01']))).toContain(
      'trap-x-01: duplicate id'
    )
  })

  it('isPositiveCase: only UNRELATED/ADD lacks a positive', () => {
    expect(isPositiveCase(base)).toBe(true)
    expect(
      isPositiveCase({ ...base, relationship: 'UNRELATED', expectedOp: 'ADD' })
    ).toBe(false)
  })
})
