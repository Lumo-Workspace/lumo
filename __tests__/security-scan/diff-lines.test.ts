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

  // ── LUM-732 review C2: hunk bodies must not be re-read as file headers ──
  // `+++ `/`--- ` were matched anywhere, so a diff *line whose content* starts
  // with `-- ` or `++ ` hijacked the parser. Both shapes are attacker-authored
  // content sitting in the very PR being scanned.

  it('keeps parsing added lines after a removed line whose content starts with "-- "', () => {
    const diff = [
      'diff --git a/db/q.sql b/db/q.sql',
      '--- a/db/q.sql',
      '+++ b/db/q.sql',
      '@@ -1,2 +1,2 @@',
      ' SELECT 1;',
      '--- old sql comment',
      '+const key = "AKIAABCDEFGHIJKLMNOP"',
    ].join('\n')
    const files = addedLinesWithNumbers(diff)
    expect(files.map(f => f.path)).toEqual(['db/q.sql'])
    expect(files[0]?.lines).toEqual([
      { lineNo: 2, text: 'const key = "AKIAABCDEFGHIJKLMNOP"' },
    ])
  })

  it('attributes an added line starting with "++ " to the real file, not a decoy', () => {
    const diff = [
      'diff --git a/src/cfg.ts b/src/cfg.ts',
      '--- a/src/cfg.ts',
      '+++ b/src/cfg.ts',
      '@@ -1,1 +1,3 @@',
      ' header',
      '+++ b/__tests__/decoy.test.ts',
      '+const key = "AKIAABCDEFGHIJKLMNOP"',
    ].join('\n')
    const files = addedLinesWithNumbers(diff)
    expect(files.map(f => f.path)).toEqual(['src/cfg.ts'])
    expect(files[0]?.lines).toEqual([
      { lineNo: 2, text: '++ b/__tests__/decoy.test.ts' },
      { lineNo: 3, text: 'const key = "AKIAABCDEFGHIJKLMNOP"' },
    ])
  })

  it('normalises CRLF line endings in paths and added text', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -0,0 +1,1 @@',
      '+const x = 1',
    ].join('\r\n')
    const files = addedLinesWithNumbers(diff)
    expect(files[0]?.path).toBe('src/a.ts')
    expect(files[0]?.lines).toEqual([{ lineNo: 1, text: 'const x = 1' }])
  })

  it('reads the omitted-count hunk header form "@@ -1 +1 @@" as one line per side', () => {
    const diff = [
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-const old = 1',
      '+const neu = 2',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -0,0 +1 @@',
      '+const other = 3',
    ].join('\n')
    const files = addedLinesWithNumbers(diff)
    expect(files.map(f => f.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(files[0]?.lines).toEqual([{ lineNo: 1, text: 'const neu = 2' }])
    expect(files[1]?.lines).toEqual([{ lineNo: 1, text: 'const other = 3' }])
  })
})
