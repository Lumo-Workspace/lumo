/** @jest-environment node */
import { addedLinesWithNumbers } from '@/lib/security-scan/diff-lines'

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 111..222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,3 +10,5 @@ function f() {',
  ' const keep = 1',
  '+const added1 = 2',
  '-const removed = 3',
  '+const added2 = 4',
  ' const keep2 = 5',
  '@@ -40,2 +42,3 @@',
  ' ctx',
  '+const added3 = 6',
  '\\ No newline at end of file',
  'diff --git a/gone.ts b/gone.ts',
  '--- a/gone.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-old',
  '-old2',
  'diff --git a/new.txt b/new.txt',
  '--- /dev/null',
  '+++ b/new.txt',
  '@@ -0,0 +1,2 @@',
  '+first',
  '+second',
].join('\n')

describe('addedLinesWithNumbers', () => {
  it('tracks new-file line numbers across hunks and skips removed/context lines', () => {
    const files = addedLinesWithNumbers(DIFF)
    expect(files.map(f => f.path)).toEqual(['src/a.ts', 'new.txt'])
    expect(files[0]?.lines).toEqual([
      { lineNo: 11, text: 'const added1 = 2' },
      { lineNo: 12, text: 'const added2 = 4' },
      { lineNo: 43, text: 'const added3 = 6' },
    ])
    expect(files[1]?.lines).toEqual([
      { lineNo: 1, text: 'first' },
      { lineNo: 2, text: 'second' },
    ])
  })

  it('returns an empty list for an empty diff and skips binary files', () => {
    expect(addedLinesWithNumbers('')).toEqual([])
    const bin = [
      'diff --git a/x.png b/x.png',
      'Binary files a/x.png and b/x.png differ',
    ].join('\n')
    expect(addedLinesWithNumbers(bin)).toEqual([])
  })
})
