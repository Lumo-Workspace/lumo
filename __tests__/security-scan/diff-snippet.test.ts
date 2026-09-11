/** @jest-environment node */
import { extractDiffHunk } from '@/lib/security-scan/diff-snippet'

const DIFF = [
  'diff --git a/lib/a.ts b/lib/a.ts',
  '--- a/lib/a.ts',
  '+++ b/lib/a.ts',
  '@@ -1,3 +1,4 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  '+const c = exec(cmd)',
  ' export {}',
  '@@ -20,2 +21,3 @@',
  ' function tail() {',
  '+  return fetch(url)',
  ' }',
  'diff --git a/lib/b.ts b/lib/b.ts',
  '--- a/lib/b.ts',
  '+++ b/lib/b.ts',
  '@@ -1,1 +1,2 @@',
  ' x',
  '+y',
].join('\n')

describe('LUM-740 extractDiffHunk', () => {
  it('returns the hunk (with its header) that contains the new-file line', () => {
    const out = extractDiffHunk(DIFF, 'lib/a.ts', 3)
    expect(out).toBe(
      [
        '@@ -1,3 +1,4 @@',
        ' const a = 1',
        '-const b = 2',
        '+const b = 3',
        '+const c = exec(cmd)',
        ' export {}',
      ].join('\n')
    )
  })

  it('picks the right hunk and the right file', () => {
    expect(extractDiffHunk(DIFF, 'lib/a.ts', 22)).toBe(
      [
        '@@ -20,2 +21,3 @@',
        ' function tail() {',
        '+  return fetch(url)',
        ' }',
      ].join('\n')
    )
    expect(extractDiffHunk(DIFF, 'lib/b.ts', 2)).toBe(
      ['@@ -1,1 +1,2 @@', ' x', '+y'].join('\n')
    )
  })

  it('returns null for a line outside every hunk or a file not in the diff', () => {
    expect(extractDiffHunk(DIFF, 'lib/a.ts', 10)).toBeNull()
    expect(extractDiffHunk(DIFF, 'lib/zzz.ts', 1)).toBeNull()
  })

  it('trims a long hunk to ±radius lines around the target', () => {
    const body = Array.from({ length: 60 }, (_, i) => `+line ${i + 1}`)
    const diff = ['+++ b/big.ts', '@@ -0,0 +1,60 @@', ...body].join('\n')
    const out = extractDiffHunk(diff, 'big.ts', 30, 2)
    expect(out).toBe(
      [
        '@@ -0,0 +1,60 @@',
        '+line 28',
        '+line 29',
        '+line 30',
        '+line 31',
        '+line 32',
      ].join('\n')
    )
  })
})
