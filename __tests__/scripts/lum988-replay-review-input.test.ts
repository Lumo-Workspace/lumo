/** @jest-environment node */
/**
 * The Martian replay hands the review what production's stage A would:
 * default path filters, the size-cap plan, the diagram decision
 * (`review-input.ts`), and applies the removal policy through production's
 * `verifierAppliesTo` (`replay-policy.ts`).
 */
import { replayVerifierAppliesTo } from '@/scripts/analysis/lum988-code-review-replay/replay-policy'
import { replayReviewInput } from '@/scripts/analysis/lum988-code-review-replay/review-input'

function section(path: string, added: number, lineChars = 10): string {
  const body = Array.from(
    { length: added },
    (_, i) => `+${String(i).padEnd(lineChars, 'x')}`
  ).join('\n')
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1,${added} @@\n${body}\n`
}

describe('replayReviewInput', () => {
  it('drops default-excluded files and asks for the diagram on a multi-file code change', () => {
    const diff =
      section('src/a.ts', 15) +
      section('src/b.ts', 15) +
      section('yarn.lock', 5)
    const input = replayReviewInput(diff)
    expect(input.kind).toBe('WHOLE')
    if (input.kind === 'OVER_CAP') throw new Error('unexpected')
    expect(input.excluded).toEqual(['yarn.lock'])
    expect(input.judgeDiff).not.toContain('yarn.lock')
    expect(input.withSequenceDiagram).toBe(true)
    // Server config never re-sends a changed path, filtered or not.
    expect(input.changedPaths).toEqual(['src/a.ts', 'src/b.ts', 'yarn.lock'])
  })

  it('does not ask for the diagram on a one-file change', () => {
    const input = replayReviewInput(section('src/a.ts', 40))
    if (input.kind === 'OVER_CAP') throw new Error('unexpected')
    expect(input.withSequenceDiagram).toBe(false)
    expect(input.skipped).toEqual([])
  })

  it('reviews the files that fit when a diff is over the cap (partial review)', () => {
    // 10 files of ~20k chars: over the 180k cap, one file dropped (< 25%).
    const diff = Array.from({ length: 10 }, (_, i) =>
      section(`src/f${i}.ts`, 200, 100)
    ).join('')
    const input = replayReviewInput(diff)
    expect(input.kind).toBe('PARTIAL')
    if (input.kind !== 'PARTIAL') throw new Error('unexpected')
    expect(input.skipped.length).toBeGreaterThan(0)
    expect(input.judgeDiff.length).toBeLessThanOrEqual(180_000)
  })

  it('skips the review when more than a quarter of the files would be dropped', () => {
    const diff = Array.from({ length: 2 }, (_, i) =>
      section(`src/f${i}.ts`, 1200, 100)
    ).join('')
    expect(replayReviewInput(diff).kind).toBe('OVER_CAP')
  })
})

describe('replayVerifierAppliesTo', () => {
  it('lets the verifier reject only non-HIGH bug findings without a path instruction', () => {
    expect(
      replayVerifierAppliesTo({ kind: 'logic_error', severity: 'MEDIUM' })
    ).toBe(true)
    expect(
      replayVerifierAppliesTo({ kind: 'logic_error', severity: 'HIGH' })
    ).toBe(false)
    expect(replayVerifierAppliesTo({ kind: 'xss', severity: 'LOW' })).toBe(
      false
    )
    expect(
      replayVerifierAppliesTo({
        kind: 'test_defect',
        severity: 'LOW',
        pathInstruction: 'src/**',
      })
    ).toBe(false)
  })
})
