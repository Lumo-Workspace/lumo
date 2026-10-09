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

describe('AST validator — open example lists are not closed enums (LUM-420)', () => {
  it('accepts any --source value: the help text is an e.g. example list, not an enum', () => {
    for (const source of ['Superpowers', 'BMad', 'SomeNewFramework']) {
      const v = validateSegment(
        `lumo task artifact add LUM-1 --kind spec --title T --file spec.md --source ${source} --agent claude-code`,
        grammar
      )
      expect(v).toMatchObject({ kind: 'valid', offending: null })
    }
  })

  it('accepts any --kind value on artifact add (opaque, e.g. example list)', () => {
    for (const kind of ['decision', 'spike', 'spec']) {
      const v = validateSegment(
        `lumo task artifact add LUM-1 --kind ${kind} --title T --file spec.md --source GSD --agent claude-code`,
        grammar
      )
      expect(v).toMatchObject({ kind: 'valid', offending: null })
    }
  })

  it('artifact update --source is equally open (example list)', () => {
    const v = validateSegment(
      'lumo task artifact update LUM-1 art123 --source Superpowers',
      grammar
    )
    expect(v.kind).toBe('valid')
  })
})

describe('AST validator — case-insensitive enums mirror runtime normalization (LUM-420)', () => {
  it.each([
    ['lumo task update LUM-9 --status DONE', '--status uppercase'],
    [
      'lumo task update LUM-9 --status IN_REVIEW',
      '--status uppercase underscore',
    ],
    [
      'lumo task update LUM-9 --status in-progress',
      '--status hyphen variant (normalizeStatus folds -/_)',
    ],
    ['lumo task update LUM-9 --priority HIGH', '--priority uppercase'],
    [
      'lumo task memory add LUM-9 --category DECISION "body"',
      '--category uppercase',
    ],
    [
      'lumo task testcase run LUM-9/TC1 --result FAIL --env LOCAL --cause DEFECT',
      '--result/--env/--cause uppercase',
    ],
    [
      'lumo task artifact add LUM-9 --kind spec --title T --file f.md --source GSD --agent CLAUDE_CODE',
      '--agent normalizeAgent folds case and separators',
    ],
    ['lumo doc list --scope ALL', '--scope uppercase'],
  ])('accepts %s (%s)', raw => {
    const v = validateSegment(raw, grammar)
    expect(v).toMatchObject({ kind: 'valid', offending: null })
  })

  it.each([
    ['lumo task update LUM-9 --status bogus', 'bogus'],
    ['lumo task update LUM-9 --status BOGUS', 'BOGUS'],
    ['lumo task update LUM-9 --priority critical', 'critical'],
    ['lumo task memory add LUM-9 --category lesson "body"', 'lesson'],
  ])('still flags genuinely unknown values: %s', (raw, offending) => {
    const v = validateSegment(raw, grammar)
    expect(v.kind).toBe('illegal-enum')
    expect(v.offending).toBe(offending)
  })
})

describe('AST validator — invokable parent commands', () => {
  // LUM-706: commander lets a parent hold both an action and subcommands, so
  // "has subcommands" never implies "needs a subcommand". Reading it that way
  // reported the primary usage of every parent-with-action as unknown-command.
  it.each([
    ['lumo priority', 'priority'],
    ['lumo priority "Ship the billing MVP."', 'priority'],
  ])('accepts bare %s on an invokable parent', (raw, commandPath) => {
    expect(validateSegment(raw, grammar)).toMatchObject({
      kind: 'valid',
      commandPath,
      offending: null,
    })
  })

  it('still resolves the subcommands hanging off an invokable parent', () => {
    expect(validateSegment('lumo priority list', grammar)).toMatchObject({
      kind: 'valid',
      commandPath: 'priority list',
    })
  })

  it('still requires a subcommand for routing-only parents', () => {
    for (const raw of ['lumo task', 'lumo doc', 'lumo sprint']) {
      const v = validateSegment(raw, grammar)
      expect(v.kind).toBe('unknown-command')
      expect(v.detail).toContain('requires a subcommand')
    }
  })

  it('rejects an unknown subcommand under a routing-only parent', () => {
    const v = validateSegment('lumo task bogus LUM-1', grammar)
    expect(v).toMatchObject({ kind: 'unknown-command', offending: 'bogus' })
  })
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
