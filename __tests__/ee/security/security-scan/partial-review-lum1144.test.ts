/**
 * LUM-1144 — which files the AI review reads when a PR is over its size cap.
 */
import {
  JUDGE_MAX_REVIEWED_FILES,
  partialReviewRank,
  planPartialReview,
} from '@/ee/security/security-scan/partial-review'

function section(path: string, approxChars: number): string {
  const head = [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
  ].join('\n')
  const body: string[] = []
  let size = head.length
  let i = 0
  while (size < approxChars) {
    const line = `+const value_${i} = ${i}`
    body.push(line)
    size += line.length + 1
    i++
  }
  return `${head}\n@@ -0,0 +1,${body.length} @@\n${body.join('\n')}`
}

const diffOf = (sections: string[]): string => sections.join('\n')

describe('partialReviewRank', () => {
  it('signal < source < test < docs', () => {
    const p = new Set(['lib/auth.ts'])
    expect(partialReviewRank('lib/auth.ts', p)).toBe(0)
    expect(partialReviewRank('lib/a.ts', p)).toBe(1)
    expect(partialReviewRank('__tests__/a.test.ts', p)).toBe(2)
    expect(partialReviewRank('fixtures/big.json', p)).toBe(2)
    expect(partialReviewRank('docs/guide.md', p)).toBe(3)
    expect(partialReviewRank('README.md', p)).toBe(3)
  })
})

describe('planPartialReview', () => {
  it('within the cap: WHOLE', () => {
    const plan = planPartialReview(diffOf([section('a.ts', 500)]), {
      maxChars: 10_000,
    })
    expect(plan).toEqual({ kind: 'WHOLE', totalFiles: 1 })
  })

  it('over the char cap with ≤25% dropped: reviews what fits, source first', () => {
    const diff = diffOf([
      section('docs/guide.md', 3_000),
      section('lib/a.ts', 3_000),
      section('lib/b.ts', 3_000),
      section('lib/c.ts', 3_000),
    ])
    const plan = planPartialReview(diff, { maxChars: 9_500 })
    expect(plan.kind).toBe('PARTIAL')
    if (plan.kind !== 'PARTIAL') return
    expect(plan.reviewed).toEqual(['lib/a.ts', 'lib/b.ts', 'lib/c.ts'])
    expect(plan.skipped).toEqual(['docs/guide.md'])
    expect(plan.diff.length).toBeLessThanOrEqual(9_500)
    expect(plan.diff).toContain('b/lib/c.ts')
    expect(plan.diff).not.toContain('docs/guide.md')
  })

  it('security-signal files go before other source', () => {
    const diff = diffOf([
      section('lib/a.ts', 3_000),
      section('lib/b.ts', 3_000),
      section('lib/c.ts', 3_000),
      section('lib/z-auth.ts', 3_000),
    ])
    const plan = planPartialReview(diff, {
      maxChars: 9_500,
      priorityPaths: ['lib/z-auth.ts'],
    })
    expect(plan.kind).toBe('PARTIAL')
    if (plan.kind !== 'PARTIAL') return
    expect(plan.reviewed).toContain('lib/z-auth.ts')
    expect(plan.skipped).toEqual(['lib/c.ts'])
  })

  it('more than a quarter dropped: OVER_CAP', () => {
    const diff = diffOf([
      section('lib/a.ts', 3_000),
      section('lib/b.ts', 3_000),
      section('lib/c.ts', 3_000),
      section('lib/d.ts', 3_000),
    ])
    const plan = planPartialReview(diff, { maxChars: 6_500 })
    expect(plan.kind).toBe('OVER_CAP')
    if (plan.kind !== 'OVER_CAP') return
    expect(plan.skipped).toHaveLength(2)
  })

  it('caps the file count at JUDGE_MAX_REVIEWED_FILES', () => {
    const sections = Array.from(
      { length: JUDGE_MAX_REVIEWED_FILES + 10 },
      (_, i) => section(`lib/f${String(i).padStart(3, '0')}.ts`, 200)
    )
    const plan = planPartialReview(diffOf(sections), { maxChars: 1_000_000 })
    expect(plan.kind).toBe('PARTIAL')
    if (plan.kind !== 'PARTIAL') return
    expect(plan.reviewed).toHaveLength(JUDGE_MAX_REVIEWED_FILES)
    expect(plan.skipped).toHaveLength(10)
  })

  it('a single file over the whole budget: OVER_CAP (nothing fits)', () => {
    const plan = planPartialReview(diffOf([section('lib/a.ts', 5_000)]), {
      maxChars: 1_000,
    })
    expect(plan.kind).toBe('OVER_CAP')
  })

  it('is deterministic', () => {
    const diff = diffOf([
      section('lib/x.ts', 2_000),
      section('lib/y.ts', 2_000),
      section('lib/w.ts', 2_000),
      section('lib/v.ts', 2_000),
      section('lib/u.ts', 2_000),
    ])
    const a = planPartialReview(diff, { maxChars: 8_300 })
    const b = planPartialReview(diff, { maxChars: 8_300 })
    expect(a).toEqual(b)
    if (a.kind !== 'PARTIAL') throw new Error(a.kind)
    // Equal sizes: path order decides.
    expect(a.skipped).toEqual(['lib/y.ts'])
  })
})
