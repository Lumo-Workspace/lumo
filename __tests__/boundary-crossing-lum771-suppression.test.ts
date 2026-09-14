/**
 * @jest-environment node
 *
 * LUM-771 — a suppression rule is always created from a crossing's EXACT
 * coalescing target. A target that happens to end in `*` (e.g. the command
 * `rm -rf __tests__/*`) must not silently become a prefix rule that swallows
 * every later `rm -rf __tests__/<file>` — live and in the retroactive sweep.
 *
 * Test names below are literal MACHINE checkpointers — do not rename.
 */
import {
  exactSuppressionPattern,
  matchesSuppressionTarget,
  suppressionTargetFilter,
} from '@/lib/boundary-crossing/suppression'

describe('LUM-771 trailing star target stays exact', () => {
  const target = 'rm -rf __tests__/*'

  it('the exact pattern for a star-terminated target matches only that target', () => {
    const pattern = exactSuppressionPattern(target)
    expect(matchesSuppressionTarget(pattern, target)).toBe(true)
    expect(
      matchesSuppressionTarget(pattern, 'rm -rf __tests__/foo.test.ts')
    ).toBe(false)
    expect(matchesSuppressionTarget(pattern, 'rm -rf __tests__/')).toBe(false)
  })

  it('the retroactive-sweep filter for that pattern is an exact filter on the original target', () => {
    expect(suppressionTargetFilter(exactSuppressionPattern(target))).toEqual({
      kind: 'exact',
      value: target,
    })
  })

  it('a target without a trailing star is stored verbatim and still matches exactly', () => {
    const plain = 'git push origin main'
    expect(exactSuppressionPattern(plain)).toBe(plain)
    expect(matchesSuppressionTarget(plain, plain)).toBe(true)
    expect(matchesSuppressionTarget(plain, plain + ' --force')).toBe(false)
  })

  it('a deliberate prefix pattern keeps its prefix semantics', () => {
    expect(
      matchesSuppressionTarget('rm -rf __tests__/*', 'rm -rf __tests__/x')
    ).toBe(true)
    expect(suppressionTargetFilter('rm -rf __tests__/*')).toEqual({
      kind: 'prefix',
      value: 'rm -rf __tests__/',
    })
  })
})
