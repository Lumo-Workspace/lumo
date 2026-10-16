/**
 * @jest-environment node
 *
 * LUM-1212 — a finding the model returned without a line still gets one when
 * its quoted evidence pins it: an exact added line first, else an exact line
 * of a changed hunk (context); otherwise it stays line-less (summary-only).
 * Never a guess: an evidence line that matches twice anchors nowhere.
 */
import { rightSideLinesWithNumbers } from '@/lib/diff/diff-lines'
import { createFindingAnchor } from '@/ee/security/security-scan/finding-anchor'
import { redactForInjection } from '@/lib/security-scan/scan-secrets'

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,4 +10,6 @@ function f() {',
  ' const keep = 1',
  '+  if (user) return null',
  '-const removed = 3',
  '+const total = items.length - 1',
  ' return { messageId: result.id }',
  '+return null',
  ' const tail = 2',
  '@@ -40,2 +42,3 @@',
  ' ctx',
  '+return null',
  ' end',
  'diff --git a/src/k.ts b/src/k.ts',
  '--- a/src/k.ts',
  '+++ b/src/k.ts',
  '@@ -0,0 +1,1 @@',
  `+const key = "ghp_${'A'.repeat(36)}"`,
].join('\n')

const anchor = createFindingAnchor(rightSideLinesWithNumbers(DIFF))
const at = (filePath: string, evidence: string, line: number | null = null) =>
  anchor({ filePath, evidence, line })

describe('LUM-1212 createFindingAnchor', () => {
  it('keeps a line the model gave, untouched', () => {
    expect(at('src/a.ts', 'const total = items.length - 1', 99)).toEqual({
      line: 99,
      method: 'model',
    })
  })

  it('anchors a line-less finding on the added line its evidence quotes', () => {
    expect(at('src/a.ts', 'const total = items.length - 1')).toEqual({
      line: 12,
      method: 'evidence',
    })
    // Indentation differences in the quote do not matter.
    expect(at('src/a.ts', 'if (user) return null')).toEqual({
      line: 11,
      method: 'evidence',
    })
  })

  it('matches evidence quoted from the masked diff the model saw', () => {
    const realMask = redactForInjection(
      `const key = "ghp_${'A'.repeat(36)}"`
    ).text
    expect(realMask).not.toContain('A'.repeat(36))
    expect(at('src/k.ts', realMask)).toEqual({ line: 1, method: 'evidence' })
  })

  it('falls back to the exact line of a changed hunk when the quote is a context line', () => {
    expect(at('src/a.ts', 'return { messageId: result.id }')).toEqual({
      line: 13,
      method: 'hunk',
    })
  })

  it('stays line-less when the quote matches more than one added line', () => {
    expect(at('src/a.ts', 'return null')).toEqual({
      line: null,
      method: 'none',
    })
  })

  it('stays line-less when the quote is nowhere in the file’s diff, or the file is not in it', () => {
    expect(at('src/a.ts', 'data = generator_fn(image_path)')).toEqual({
      line: null,
      method: 'none',
    })
    expect(at('src/other.ts', 'const keep = 1')).toEqual({
      line: null,
      method: 'none',
    })
    expect(at('src/a.ts', '   ')).toEqual({ line: null, method: 'none' })
  })

  it('never anchors on a removed line', () => {
    expect(at('src/a.ts', 'const removed = 3')).toEqual({
      line: null,
      method: 'none',
    })
  })
})

describe('LUM-1212 rightSideLinesWithNumbers', () => {
  it('lists added and context lines with new-file numbers, never removed ones', () => {
    const a = rightSideLinesWithNumbers(DIFF).find(f => f.path === 'src/a.ts')!
    expect(a.lines.slice(0, 6)).toEqual([
      { lineNo: 10, text: 'const keep = 1', added: false },
      { lineNo: 11, text: '  if (user) return null', added: true },
      { lineNo: 12, text: 'const total = items.length - 1', added: true },
      { lineNo: 13, text: 'return { messageId: result.id }', added: false },
      { lineNo: 14, text: 'return null', added: true },
      { lineNo: 15, text: 'const tail = 2', added: false },
    ])
  })
})
