import {
  renderCriteriaSection,
  criterionCard,
  criterionManifest,
  criteriaBudgetSection,
  renderCriteriaDraftNudge,
  type CriterionCard,
} from '@/lib/context/render/criteria'

function card(over: Partial<CriterionCard> = {}): CriterionCard {
  return {
    id: 'c-1',
    statement: 'all new endpoints have route tests',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest',
    evidenceRequired: false,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    ...over,
  }
}

describe('criterionCard', () => {
  it('renders type, statement, and the checkpointer line', () => {
    expect(criterionCard(card())).toBe(
      '- [MACHINE] all new endpoints have route tests\n  ↳ check: npx jest'
    )
  })

  it('keeps the agent-draft baseline untagged but tags human/review provenance and evidence', () => {
    expect(
      criterionCard(card({ verifierType: 'HUMAN', checkpointer: null }))
    ).toBe('- [HUMAN] all new endpoints have route tests')
    expect(criterionCard(card({ source: 'HUMAN_EDIT' }))).toContain(
      '（HUMAN_EDIT）'
    )
    expect(
      criterionCard(card({ source: 'REVIEW_ADDED', addedAtRound: 2 }))
    ).toContain('（REVIEW_ADDED · r2）')
    expect(criterionCard(card({ evidenceRequired: true }))).toContain(
      '· evidence required'
    )
  })
})

describe('criterionManifest', () => {
  it('truncates long statements', () => {
    const long = 'x'.repeat(120)
    const line = criterionManifest(card({ statement: long }))
    expect(line).toBe(`- [MACHINE] ${'x'.repeat(80)}…`)
  })
})

describe('LUM-346 control-char strip at the render source', () => {
  // The contract deliberately skips the untrusted wrappers (where LUM-346
  // hung the strip), so the render source must strip instead — otherwise the
  // session-start hook envelope carries raw ESC to Claude Code stdout.
  it('strips ANSI escapes from statement and checkpointer in the card', () => {
    const out = criterionCard(
      card({
        statement: 'evil\x1b[31mred\x1b[0m statement',
        checkpointer: 'npx jest \x1b]0;title\x07',
      })
    )
    expect(out).not.toContain('\x1b')
    expect(out).not.toContain('\x07')
    expect(out).toContain('evil[31mred[0m statement')
  })

  it('strips before truncating in the manifest (length measured on clean text)', () => {
    // 5 control chars + exactly-80 visible chars: stripping first means the
    // clean text fits and nothing is truncated.
    const line = criterionManifest(
      card({ statement: '\x1b\x07\x00\x9b\x7f' + 'x'.repeat(80) })
    )
    expect(line).toBe(`- [MACHINE] ${'x'.repeat(80)}`)
  })
})

describe('renderCriteriaSection', () => {
  it('returns "" for an empty contract', () => {
    expect(renderCriteriaSection([])).toBe('')
  })

  it('renders the heading plus one card per criterion', () => {
    const out = renderCriteriaSection([
      card(),
      card({ id: 'c-2', verifierType: 'HUMAN', checkpointer: null }),
    ])
    expect(out).toContain('## Acceptance criteria (contract)')
    expect(out).toContain('- [MACHINE] all new endpoints have route tests')
    expect(out).toContain('- [HUMAN] all new endpoints have route tests')
  })
})

describe('criteriaBudgetSection', () => {
  it('renders full cards within budget and manifests beyond it', () => {
    const section = criteriaBudgetSection([card(), card({ id: 'c-2' })])
    const out = section.render(1)
    expect(out).toContain('↳ check: npx jest')
    expect(out).toContain('Remaining 1 (manifest only):')
  })
})

describe('renderCriteriaDraftNudge', () => {
  it('tells the agent to draft 3–7 criteria before the first line of code', () => {
    const nudge = renderCriteriaDraftNudge()
    expect(nudge).toContain('## Acceptance criteria (contract)')
    expect(nudge).toContain('3–7 outcome-level')
    expect(nudge).toContain('lumo task criteria set')
  })
})
