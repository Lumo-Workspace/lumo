import { verifyReadback } from '../../src/commands/task-criteria-set'

const submit = [
  { statement: 'a', checkpointer: 'git diff', referentKind: 'EXTERNAL_FACT' },
]

it('returns no mismatches when stored matches submitted', () => {
  const stored = [
    { statement: 'a', checkpointer: 'git diff', referentKind: 'EXTERNAL_FACT' },
  ]
  expect(verifyReadback(submit, stored as any)).toEqual([])
})
it('flags a corrupted checkpointer (transport ate it)', () => {
  const stored = [
    { statement: 'a', checkpointer: '', referentKind: 'EXTERNAL_FACT' },
  ]
  const issues = verifyReadback(submit, stored as any)
  expect(issues.length).toBeGreaterThan(0)
  expect(issues[0]).toMatch(/checkpointer/i)
})
it('flags a corrupted referentKind', () => {
  const stored = [
    {
      statement: 'a',
      checkpointer: 'git diff',
      referentKind: 'AGENT_CONSTRUCTED_STATE',
    },
  ]
  expect(verifyReadback(submit, stored as any).length).toBeGreaterThan(0)
})
