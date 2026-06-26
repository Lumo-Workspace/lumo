import {
  formatCriteriaRows,
  type CriterionRow,
} from '../../src/commands/task-criteria-list'

const row = (over: Partial<CriterionRow>): CriterionRow => ({
  id: 'c1',
  statement: 's',
  verifierType: 'MACHINE',
  checkpointer: 'npx jest x',
  evidenceRequired: false,
  source: 'AGENT_DRAFT',
  addedAtRound: 0,
  ...over,
})

it('shows UNVERIFIED_ASSERTION for an EXTERNAL_FACT claim backed only by jest', () => {
  const out = formatCriteriaRows([
    row({ referentKind: 'EXTERNAL_FACT', checkpointer: 'npx jest x' }),
  ])
  expect(out).toMatch(/UNVERIFIED_ASSERTION/)
})
it('shows EXTERNAL_FACT for a git-grounded claim', () => {
  const out = formatCriteriaRows([
    row({
      referentKind: 'EXTERNAL_FACT',
      checkpointer: 'git diff origin/main',
    }),
  ])
  expect(out).toMatch(/EXTERNAL_FACT/)
  expect(out).not.toMatch(/UNVERIFIED/)
})
