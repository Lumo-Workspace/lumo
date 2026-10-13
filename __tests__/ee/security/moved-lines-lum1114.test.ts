/**
 * @jest-environment node
 *
 * LUM-1114 — a line the PR only moved (removed and re-added in the same file)
 * is not an added line for the code-rule pipeline.
 */
// contents.ts pulls the GitHub App auth (ESM-only @octokit) — not used here.
jest.mock('@/lib/integrations/github/auth', () => ({}))

import { neutralizeMovedLines } from '@/ee/security/services/policy/moved-lines'
import { addedLinesFromDiff } from '@/lib/integrations/github/contents'
import { matchDiffRegex } from '@/ee/security/services/policy/predicate-eval'

describe('code rules: moved lines are not added lines', () => {
  const diff = [
    'diff --git a/components/Card.tsx b/components/Card.tsx',
    '--- a/components/Card.tsx',
    '+++ b/components/Card.tsx',
    '@@ -1,6 +1,8 @@',
    '-      {intl.formatDate(new Date(task.updatedAt))}',
    '+<div className="card">',
    '+    {intl.formatDate(new Date(task.updatedAt))}',
    '+</div>',
    ' export const x = 1',
  ].join('\n')

  it('a moved violating line no longer reaches the diff-regex pass', () => {
    const added = addedLinesFromDiff(neutralizeMovedLines(diff)).flatMap(
      f => f.addedLines
    )
    expect(added).toEqual(['<div className="card">', '</div>'])
    expect(matchDiffRegex('new Date\\(', added).matched).toBe(false)
  })

  it('pairs as a multiset within one file', () => {
    const once = [
      '+++ b/a.ts',
      '-const now = new Date()',
      '+const now = new Date()',
      '+const now = new Date()',
    ].join('\n')
    const added = addedLinesFromDiff(neutralizeMovedLines(once)).flatMap(
      f => f.addedLines
    )
    expect(added).toEqual(['const now = new Date()'])
  })

  it('never pairs across files — a deletion elsewhere hides nothing', () => {
    const twoFiles = [
      '--- a/a.ts',
      '+++ b/a.ts',
      '-const now = new Date()',
      '--- a/b.ts',
      '+++ b/b.ts',
      '+const now = new Date()',
    ].join('\n')
    expect(neutralizeMovedLines(twoFiles)).toBe(twoFiles)
  })

  it('a genuinely new violation still fires', () => {
    const fresh = ['+++ b/a.ts', '+const now = new Date()'].join('\n')
    expect(neutralizeMovedLines(fresh)).toBe(fresh)
    const added = addedLinesFromDiff(neutralizeMovedLines(fresh)).flatMap(
      f => f.addedLines
    )
    expect(matchDiffRegex('new Date\\(\\)', added).matched).toBe(true)
  })
})
