// Mock auth module to avoid @octokit/auth-app ESM issue in Jest
jest.mock('@/lib/integrations/github/auth', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('test-token'),
}))

import { addedLinesFromDiff } from '@/lib/integrations/github/contents'

test('addedLinesFromDiff returns added lines per file, excluding +++ headers', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,3 @@',
    ' const x = 1',
    '+console.log(x)',
    '-const y = 2',
  ].join('\n')
  const out = addedLinesFromDiff(diff)
  expect(out).toEqual([{ path: 'src/a.ts', addedLines: ['console.log(x)'] }])
})

test('addedLinesFromDiff handles multiple files', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,1 +1,2 @@',
    ' const x = 1',
    '+const z = 3',
    'diff --git a/src/b.ts b/src/b.ts',
    '--- a/src/b.ts',
    '+++ b/src/b.ts',
    '@@ -1,1 +1,2 @@',
    ' const a = 1',
    '+const b = 2',
  ].join('\n')
  const out = addedLinesFromDiff(diff)
  expect(out).toEqual([
    { path: 'src/a.ts', addedLines: ['const z = 3'] },
    { path: 'src/b.ts', addedLines: ['const b = 2'] },
  ])
})

test('addedLinesFromDiff excludes files with only deletions', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,2 +1,1 @@',
    ' const x = 1',
    '-const y = 2',
  ].join('\n')
  const out = addedLinesFromDiff(diff)
  expect(out).toEqual([])
})
