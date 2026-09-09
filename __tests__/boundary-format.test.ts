/**
 * @jest-environment node
 *
 * LUM-590 — boundaryCategoryLabel tests.
 * Verifies that the new categories PROJECT_RULE_VIOLATION and POLICY_WEAKENING
 * are properly localized and do NOT fall through to the raw default fallback.
 */
import { boundaryCategoryLabel } from '@/app/workspace/[workspaceUrl]/components/TaskDetailTimeline/boundary-format'
import type { useIntl } from 'react-intl'

/** Minimal intl stub that records which message id was requested. */
function makeIntl(locale = 'en'): ReturnType<typeof useIntl> {
  return {
    locale,
    formatMessage: ({
      id,
      defaultMessage,
    }: {
      id: string
      defaultMessage?: string
    }) => defaultMessage ?? id,
  } as unknown as ReturnType<typeof useIntl>
}

test('boundaryCategoryLabel returns localized label for PROJECT_RULE_VIOLATION (not raw default)', () => {
  const intl = makeIntl()
  const label = boundaryCategoryLabel('PROJECT_RULE_VIOLATION', intl)
  // Must NOT fall through to the default: "project rule violation"
  expect(label).not.toBe('project rule violation')
  // Must use the i18n key — the stub returns the defaultMessage
  expect(label).toBe('violated a project rule from CLAUDE.md')
})

test('boundaryCategoryLabel returns localized label for POLICY_WEAKENING (not raw default)', () => {
  const intl = makeIntl()
  const label = boundaryCategoryLabel('POLICY_WEAKENING', intl)
  // Must NOT fall through to the default: "policy weakening"
  expect(label).not.toBe('policy weakening')
  expect(label).toBe('weakened a blocking policy rule')
})

// LUM-736: the three L4 Session Guard categories must not fall through to the
// raw-enum default either.
test.each([
  ['SENSITIVE_PATH_EDIT', 'sensitive path edit', 'edited a sensitive path'],
  ['HOOK_BYPASS', 'hook bypass', 'bypassed git hooks'],
  ['TEST_FILE_DELETED', 'test file deleted', 'deleted a test file'],
])(
  'boundaryCategoryLabel returns localized label for %s (not raw default)',
  (category, rawDefault, expected) => {
    const label = boundaryCategoryLabel(category, makeIntl())
    expect(label).not.toBe(rawDefault)
    expect(label).toBe(expected)
  }
)

test('boundaryCategoryLabel still handles existing known categories', () => {
  const intl = makeIntl()
  expect(boundaryCategoryLabel('HARDCODED_SECRET', intl)).toBe(
    'hardcoded secret'
  )
  expect(boundaryCategoryLabel('TEST_TAMPERING', intl)).toBe(
    'edited a test a check depends on'
  )
})

test('boundaryCategoryLabel falls through to default for unknown categories', () => {
  const intl = makeIntl()
  expect(boundaryCategoryLabel('SOME_NEW_UNKNOWN', intl)).toBe(
    'some new unknown'
  )
})
