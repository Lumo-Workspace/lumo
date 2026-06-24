/** @jest-environment node */
import {
  resolveDelivery,
  filterGhByExactTag,
  truncateDiff,
} from '@/lib/claim-faithfulness/diff-oracle'
import type { CommandRunner } from '@/lib/claim-faithfulness/types'

// A fake git that answers the calls resolveDelivery makes, keyed by argv.
function fakeGit(map: Record<string, string>): CommandRunner {
  return (file, args) => {
    expect(file).toBe('git')
    if (args.includes('--format=%H')) return map.shas ?? ''
    if (args.includes('--format=%s')) return map.subjects ?? ''
    if (args.includes('--numstat')) return map.numstat ?? ''
    return map.diff ?? ''
  }
}

describe('resolveDelivery', () => {
  it('uses -F fixed-strings grep and unions multiple squash commits', () => {
    const run = fakeGit({
      shas: 'aaa111\nbbb222\n',
      subjects:
        'feat: thing one [LUM-582] (#700)\nfix: thing two [LUM-582] (#701)\n',
      numstat: '10\t2\tlib/a.ts\n5\t0\tlib/b.ts\n',
      diff: 'diff --git a/lib/a.ts b/lib/a.ts\n+code\n',
    })
    const calls: string[][] = []
    const spy: CommandRunner = (f, a) => {
      calls.push(a)
      return run(f, a)
    }
    const d = resolveDelivery('LUM-582', spy)
    expect(d).not.toBeNull()
    expect(d!.shas).toEqual(['aaa111', 'bbb222'])
    expect(d!.prNumbers).toEqual([700, 701])
    expect(d!.changedFiles).toEqual(['lib/a.ts', 'lib/b.ts'])
    expect(d!.additions).toBe(15)
    expect(d!.deletions).toBe(2)
    expect(d!.diff).toContain('diff --git')
    // every grep call must carry -F
    const greps = calls.filter(a => a.includes('--grep'))
    expect(greps.length).toBeGreaterThan(0)
    greps.forEach(a => expect(a).toContain('-F'))
    // the grep literal is the bracketed identifier
    greps.forEach(a => expect(a).toContain('[LUM-582]'))
  })

  it('returns null when no squash commit matches', () => {
    const d = resolveDelivery('LUM-999', fakeGit({ shas: '\n' }))
    expect(d).toBeNull()
  })

  it('rejects a malformed identifier without shelling out', () => {
    const run: CommandRunner = () => {
      throw new Error('should not run')
    }
    expect(resolveDelivery('not-an-id', run)).toBeNull()
  })
})

describe('filterGhByExactTag', () => {
  it('keeps only PRs whose title carries the exact literal [identifier]', () => {
    const prs = [
      { number: 635, title: 'feat: x [LUM-540]' },
      { number: 636, title: 'feat: y [LUM-541]' }, // fuzzy neighbor
    ]
    expect(filterGhByExactTag(prs, 'LUM-540')).toEqual([635])
  })
})

describe('truncateDiff', () => {
  it('caps length and marks truncation', () => {
    const out = truncateDiff('x'.repeat(50), 10)
    expect(out.length).toBeLessThan(50)
    expect(out).toContain('truncated')
  })
  it('passes short diffs through unchanged', () => {
    expect(truncateDiff('short', 100)).toBe('short')
  })
})
