/**
 * LUM-751 — pure suppression-rule helpers: the non-suppressible red line, the
 * target-pattern match, rule lookup and the system disposition note.
 */
import {
  NON_SUPPRESSIBLE_CATEGORIES,
  isSuppressibleCategory,
  matchesSuppressionTarget,
  findSuppressionRule,
  autoSuppressedNote,
} from '@/lib/boundary-crossing/suppression'

test('the HIGH classes can never be rule-suppressed', () => {
  for (const c of [
    'HARDCODED_SECRET',
    'DESTRUCTIVE_DB_COMMAND',
    'EXFILTRATION_PUBLIC',
    'CLOUD_DATA_DELETION',
    'INFRA_TERMINATION',
    'DESTRUCTIVE_FS_COMMAND',
    'UNTRUSTED_CODE_EXECUTION',
  ] as const) {
    expect(NON_SUPPRESSIBLE_CATEGORIES.has(c)).toBe(true)
    expect(isSuppressibleCategory(c)).toBe(false)
  }
  expect(isSuppressibleCategory('PROJECT_RULE_VIOLATION')).toBe(true)
  expect(isSuppressibleCategory('NEW_NPM_DEPENDENCY')).toBe(true)
})

test('target pattern: exact or trailing-star prefix; null target never matches', () => {
  expect(matchesSuppressionTarget('actionrule:r1', 'actionrule:r1')).toBe(true)
  expect(matchesSuppressionTarget('actionrule:r1', 'actionrule:r2')).toBe(false)
  expect(
    matchesSuppressionTarget('npm install *', 'npm install left-pad')
  ).toBe(true)
  expect(matchesSuppressionTarget('actionrule:r1', null)).toBe(false)
})

test('findSuppressionRule ignores other categories and non-suppressible ones, returns the first match', () => {
  const rules = [
    {
      id: 'a',
      category: 'NEW_NPM_DEPENDENCY' as const,
      targetPattern: 'npm install x',
      reason: null,
    },
    {
      id: 'b',
      category: 'PROJECT_RULE_VIOLATION' as const,
      targetPattern: 'actionrule:r1',
      reason: 'PR target',
    },
    {
      id: 'c',
      category: 'HARDCODED_SECRET' as const,
      targetPattern: '*',
      reason: null,
    },
  ]
  expect(
    findSuppressionRule(rules, 'PROJECT_RULE_VIOLATION', 'actionrule:r1')?.id
  ).toBe('b')
  expect(
    findSuppressionRule(rules, 'PROJECT_RULE_VIOLATION', 'npm install x')
  ).toBeNull()
  expect(findSuppressionRule(rules, 'HARDCODED_SECRET', 'lib/x.ts')).toBeNull()
  expect(autoSuppressedNote(rules[1]!)).toContain('b')
  expect(autoSuppressedNote(rules[1]!)).toContain('PR target')
})
