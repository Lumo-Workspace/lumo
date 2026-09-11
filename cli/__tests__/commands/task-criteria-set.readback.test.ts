import { verifyReadback } from '../../src/commands/task-criteria-set'

const submit = [{ statement: 'a', checkpointer: 'git diff' }]

it('returns no mismatches when stored matches submitted', () => {
  const stored = [{ statement: 'a', checkpointer: 'git diff' }]
  expect(verifyReadback(submit, stored as any)).toEqual([])
})
it('flags a corrupted checkpointer (transport ate it)', () => {
  const stored = [{ statement: 'a', checkpointer: '' }]
  const issues = verifyReadback(submit, stored as any)
  expect(issues.length).toBeGreaterThan(0)
  expect(issues[0]).toMatch(/checkpointer/i)
})
// LUM-733: referentKind is derived server-side from the checkpointer, so a
// submitted declaration is advisory and verifyReadback no longer compares it —
// a stored kind that differs from the declaration is not landing corruption.
it('does not flag a stored referentKind that differs from the advisory declaration', () => {
  const declared = [
    { statement: 'a', checkpointer: 'git diff', referentKind: 'EXTERNAL_FACT' },
  ]
  const stored = [
    {
      statement: 'a',
      checkpointer: 'git diff',
      referentKind: 'AGENT_CONSTRUCTED_STATE',
    },
  ]
  expect(verifyReadback(declared, stored as any)).toEqual([])
})
