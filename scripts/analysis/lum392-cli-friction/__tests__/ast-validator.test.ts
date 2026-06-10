/**
 * LUM-413: AST validator against the committed grammar snapshot.
 * The regression set is fixture-encoded real prod history — re-run it after
 * any CLI change (grammar-drift.test.ts forces the snapshot to regenerate)
 * to detect documentation/behavior drift.
 */
import grammarJson from '../grammar.json'
import type { CliGrammar } from '../grammar'
import { validateSegment } from '../validate'
import {
  CONSTRUCTION_EDGE_CASES,
  HALLUCINATION_CASES,
  VALID_CASES,
} from '../fixtures/ast-regression'

const grammar = grammarJson as CliGrammar

describe('AST validator — historical hallucination regression set', () => {
  it.each(HALLUCINATION_CASES.map(c => [c.raw, c] as const))(
    'flags %s',
    (_raw, c) => {
      const v = validateSegment(c.raw, grammar)
      expect(v.kind).toBe(c.expect)
      if (c.offending) expect(v.offending).toBe(c.offending)
    }
  )

  it('every historical hallucination is flagged (none slips through as valid)', () => {
    for (const c of HALLUCINATION_CASES) {
      expect(validateSegment(c.raw, grammar).kind).not.toBe('valid')
    }
  })
})

describe('AST validator — valid invocations produce zero false positives', () => {
  it.each(VALID_CASES.map(c => [c.raw, c] as const))(
    'accepts %s',
    (_raw, c) => {
      const v = validateSegment(c.raw, grammar)
      expect(v).toMatchObject({ kind: 'valid', offending: null })
    }
  )
})

describe('AST validator — construction edge cases', () => {
  it.each(CONSTRUCTION_EDGE_CASES.map(c => [c.raw, c] as const))(
    'judges %s',
    (_raw, c) => {
      const v = validateSegment(c.raw, grammar)
      expect(v.kind).toBe(c.expect)
      expect(v.offending).toBe(c.offending ?? null)
    }
  )

  it('judges construction only — a well-formed call is valid even when pointless', () => {
    // Scope boundary: should-it-have-been-called is the attribution layer's
    // job; the validator must say "valid" for a structurally fine repeat.
    expect(validateSegment('lumo whoami', grammar).kind).toBe('valid')
  })
})
