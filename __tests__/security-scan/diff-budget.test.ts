import { splitDiffByFile } from '@/lib/security-scan/diff-lines'
import {
  packSecurityDiff,
  truncateSecurityDiff,
  SECURITY_DIFF_MAX_CHARS,
} from '@/lib/security-scan/truncate'

function fileSection(path: string, body: string): string {
  const added = body.split('\n')
  return [
    `diff --git a/${path} b/${path}`,
    'index 1111111..2222222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${added.length} @@`,
    ...added.map(l => `+${l}`),
  ].join('\n')
}

const bulk = (n: number): string =>
  Array.from({ length: n }, (_, i) => `const x${i} = ${i}`).join('\n')

describe('splitDiffByFile', () => {
  it('cuts a diff into one section per file and rebuilds it exactly', () => {
    const diff = [
      fileSection('app/a.ts', 'const a = 1'),
      fileSection('lib/b.ts', 'const b = 2'),
    ].join('\n')

    const sections = splitDiffByFile(diff)
    expect(sections.map(s => s.path)).toEqual(['app/a.ts', 'lib/b.ts'])
    expect(sections.map(s => s.text).join('\n')).toBe(diff)
  })

  // LUM-732 review C2, now on the section boundary: an ADDED line is diff
  // CONTENT, and content must never be read as a header. A naive
  // `split(/^diff --git /m)` here would let a PR author open a fake section
  // and relabel everything after it with a path of their choosing.
  it('does not let an added line that looks like a header relabel a section', () => {
    // The attack shape is NOT `+diff --git …` — a body line always carries its
    // `+`/`-` prefix, so it cannot spell `diff --git ` at column 0. It is a
    // line whose prefix MERGES with its text: an added line reading `++ b/x`
    // renders as `+++ b/x`, and a removed line reading `-- a/x` renders as
    // `--- a/x`. That is the LUM-732 C2 bug, here able to hang a file of the
    // attacker's choosing on someone else's section.
    const diff = [
      'diff --git a/lib/real.ts b/lib/real.ts',
      '--- a/lib/real.ts',
      '+++ b/lib/real.ts',
      // 一个加行和一个删行，正文分别是 `++ b/evil.ts` 和 `-- a/evil.ts`；
      // 带上 diff 前缀后，它们在文件里就是货真价实的 `+++ ` / `--- ` 开头。
      '@@ -1,1 +1,1 @@',
      '+++ b/evil.ts',
      '--- a/evil.ts',
      fileSection('lib/after.ts', 'const after = 1'),
    ].join('\n')

    const sections = splitDiffByFile(diff)
    expect(sections.map(s => s.path)).toEqual(['lib/real.ts', 'lib/after.ts'])
    expect(sections[0]!.text).toContain('+++ b/evil.ts')
  })

  it('attributes a deleted file to no path', () => {
    const diff = [
      'diff --git a/gone.ts b/gone.ts',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-const gone = 1',
    ].join('\n')
    expect(splitDiffByFile(diff).map(s => s.path)).toEqual([null])
  })
})

describe('packSecurityDiff', () => {
  it('passes a diff under the budget through untouched', () => {
    const diff = fileSection('app/a.ts', 'const a = 1')
    expect(packSecurityDiff(diff)).toEqual({
      text: diff,
      truncated: false,
      covered: ['app/a.ts'],
      dropped: [],
    })
  })

  // The defect this replaces: the cut was positional, so a file's coverage
  // was decided by where its NAME sorted in the diff.
  it('reviews the file carrying the security signal even when it sorts last', () => {
    // Sized so exactly TWO of the three sections fit. If the sink file were
    // small, skip-and-continue would slip it in whatever the order — and the
    // test would pass with the priority pass deleted (it did, once).
    const diff = [
      fileSection('app/a.ts', bulk(1400)),
      fileSection('lib/b.ts', bulk(1400)),
      fileSection('zz/sink.ts', `${bulk(1400)}\nexec(userInput)`),
    ].join('\n')
    expect(diff.length).toBeGreaterThan(SECURITY_DIFF_MAX_CHARS)
    // 按字节切时 sink 的头能露出来，但真正的信号行在文件末尾，切不到。
    expect(diff.slice(0, SECURITY_DIFF_MAX_CHARS)).not.toContain(
      'exec(userInput)'
    )

    const blind = packSecurityDiff(diff)
    expect(blind.dropped).toContain('zz/sink.ts')

    const packed = packSecurityDiff(diff, { priorityPaths: ['zz/sink.ts'] })
    expect(packed.covered).toContain('zz/sink.ts')
    expect(packed.text).toContain('exec(userInput)')
    expect(packed.truncated).toBe(true)
  })

  it('names every dropped file instead of only flagging that something was', () => {
    const diff = [
      fileSection('a.ts', bulk(3000)),
      fileSection('b.ts', bulk(3000)),
      fileSection('c.ts', 'const c = 1'),
    ].join('\n')

    const packed = packSecurityDiff(diff)
    expect([...packed.covered, ...packed.dropped].sort()).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
    ])
    expect(packed.dropped.length).toBeGreaterThan(0)
    expect(packed.text).toContain('files omitted to fit the review budget')
  })

  it('skips one oversized file instead of letting it eat the budget', () => {
    const diff = [
      fileSection('huge.lock', bulk(8000)),
      fileSection('small.ts', 'const small = 1'),
    ].join('\n')

    const packed = packSecurityDiff(diff)
    expect(packed.covered).toEqual(['small.ts'])
    expect(packed.dropped).toEqual(['huge.lock'])
  })

  it('never hands the judge an empty diff when no whole file fits', () => {
    const diff = fileSection('huge.ts', bulk(8000))
    const packed = packSecurityDiff(diff)
    expect(packed.text.length).toBeGreaterThan(0)
    expect(packed.text).toContain('[diff truncated]')
    expect(packed.truncated).toBe(true)
    expect(packed.dropped).toEqual(['huge.ts'])
  })

  it('keeps every kept section whole — no mid-hunk cut', () => {
    const diff = [
      fileSection('a.ts', bulk(3000)),
      fileSection('b.ts', 'const b = 1'),
    ].join('\n')
    const packed = packSecurityDiff(diff)
    for (const path of packed.covered) {
      expect(packed.text).toContain(`+++ b/${path}`)
    }
  })

  it('truncateSecurityDiff keeps the LUM-732 two-field contract', () => {
    expect(truncateSecurityDiff('+a\n+b')).toEqual({
      text: '+a\n+b',
      truncated: false,
    })
    const long = fileSection('x.ts', bulk(8000))
    expect(truncateSecurityDiff(long).truncated).toBe(true)
  })
})
