/** @jest-environment node */
import {
  formatCriteriaRows,
  type CriterionRow,
} from '@/cli/src/commands/task-criteria-list'

function row(over: Partial<CriterionRow> = {}): CriterionRow {
  return {
    id: 'c1',
    statement: 'tests pass',
    verifierType: 'MACHINE',
    checkpointer: 'npx jest',
    evidenceRequired: false,
    source: 'AGENT_DRAFT',
    addedAtRound: 0,
    ...over,
  }
}

describe('formatCriteriaRows', () => {
  it('returns "" for an empty contract', () => {
    expect(formatCriteriaRows([])).toBe('')
  })

  it('prints id, type, provenance, statement and an indented checkpointer line', () => {
    const out = formatCriteriaRows([
      row(),
      row({
        id: 'c2',
        verifierType: 'HUMAN',
        checkpointer: null,
        source: 'REVIEW_ADDED',
        addedAtRound: 2,
        evidenceRequired: true,
        statement: 'copy reviewed',
      }),
    ])
    expect(out).toBe(
      [
        'c1  [MACHINE]  AGENT_DRAFT@r0 ⟨UNCLASSIFIED⟩  tests pass',
        '  ↳ check: npx jest',
        'c2  [HUMAN]  REVIEW_ADDED@r2  [evidence] ⟨UNCLASSIFIED⟩  copy reviewed',
        '',
      ].join('\n')
    )
  })

  it('sanitizes untrusted free text (ANSI escapes stripped)', () => {
    const out = formatCriteriaRows([
      row({ statement: 'evil[31mred', checkpointer: null }),
    ])
    expect(out).not.toContain('')
  })
})
