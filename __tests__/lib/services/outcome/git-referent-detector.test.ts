import {
  detectGitRejections,
  deriveDetectorVerdict,
  type GitRunner,
} from '@/lib/services/outcome/git-referent-detector'
import { OUTCOME_VERDICTS } from '@/lib/services/outcome/verdict'

// ── Real-history referent (validated against this repo's git) ──────────────
// LUM-587 (#715) squash commit 7930b19b… was reverted by aee920c6…, whose body
// carries git's machine-written `This reverts commit 7930b19b…` trailer. The
// reverse patch-id of the delivery equals the revert commit's patch-id. These
// fixtures are the literal SHAs/strings git produced — see the task's empirical
// validation — so the unit tests anchor on a real topological referent.
const DELIVERY = '7930b19b84ca2e1e409f056a51255627103d12e2'
const REVERT = 'aee920c669b44aa3875327574304067e353bf219'
const RS = '\x1e' // record separator between commits
const FS = '\x1f' // field separator between %H and %b

/**
 * Build a fake GitRunner from a routing table. Each entry matches on a substring
 * of the joined args (and optional stdin `input`) and returns canned output.
 * Unmatched calls return '' — a forgiving default so a test only stubs the calls
 * its scenario exercises.
 */
function fakeGit(
  routes: Array<{ match: string; input?: string; out: string }>
): GitRunner {
  return (_file, args, input) => {
    const joined = args.join(' ')
    for (const r of routes) {
      if (!joined.includes(r.match)) continue
      if (r.input !== undefined && r.input !== input) continue
      return r.out
    }
    return ''
  }
}

describe('detectGitRejections — git-topology rejection signals (LUM-601)', () => {
  it('flags a real reverted delivery as REJECTED via revert-commit backreference', () => {
    const run = fakeGit([
      {
        // `git log …--grep 'This reverts commit'` over commits after the delivery
        match: 'This reverts commit',
        out: `${REVERT}${FS}Revert "chore: 收口 LLM model id [LUM-587] (#715)"\n\nThis reverts commit ${DELIVERY}.\n${RS}`,
      },
    ])
    const signals = detectGitRejections(
      { identifier: 'LUM-587', shas: [DELIVERY] },
      run
    )
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      kind: 'REVERTED',
      mechanism: 'revert-commit',
      revertingSha: REVERT,
      revertedSha: DELIVERY,
    })
    expect(deriveDetectorVerdict(signals)).toBe('REJECTED')
  })

  it('flags a downstream content reversal as REJECTED via reverse patch-id', () => {
    const DOWNSTREAM = 'c'.repeat(40)
    const deliveryReverseDiff = 'DIFF:reverse-of-delivery'
    const downstreamDiff = 'DIFF:downstream'
    const PID = 'e13327f1a3f21ce9e182ddde949e9f1f8d8fec91'
    const run = fakeGit([
      // no formal revert trailer in range
      { match: 'This reverts commit', out: '' },
      // reverse diff of the delivery (git diff D D^)
      { match: `diff ${DELIVERY} ${DELIVERY}^`, out: deliveryReverseDiff },
      // patch-id of the delivery's reverse diff
      { match: 'patch-id', input: deliveryReverseDiff, out: `${PID} 0\n` },
      // delivery's changed files
      { match: `show ${DELIVERY} --numstat`, out: '3\t4\tlib/foo.ts\n' },
      // downstream candidates touching those files
      { match: 'lib/foo.ts', out: `${DOWNSTREAM}\n` },
      // downstream commit's diff
      { match: `show --format= ${DOWNSTREAM}`, out: downstreamDiff },
      // patch-id of the downstream commit == reverse patch-id of the delivery
      { match: 'patch-id', input: downstreamDiff, out: `${PID} 0\n` },
    ])
    const signals = detectGitRejections(
      { identifier: 'LUM-900', shas: [DELIVERY] },
      run
    )
    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({
      kind: 'DOWNSTREAM_REDIRECT',
      mechanism: 'patch-reversal',
      revertingSha: DOWNSTREAM,
      revertedSha: DELIVERY,
    })
    expect(deriveDetectorVerdict(signals)).toBe('REJECTED')
  })

  it('returns INCONCLUSIVE for a delivery never reverted', () => {
    const run = fakeGit([
      { match: 'This reverts commit', out: '' },
      { match: `diff ${DELIVERY} ${DELIVERY}^`, out: 'DIFF:rev' },
      { match: 'patch-id', input: 'DIFF:rev', out: 'PIDREV 0\n' },
      { match: `show ${DELIVERY} --numstat`, out: '3\t4\tlib/foo.ts\n' },
      { match: 'lib/foo.ts', out: `${'d'.repeat(40)}\n` },
      { match: `show --format= ${'d'.repeat(40)}`, out: 'DIFF:unrelated' },
      // unrelated downstream commit: patch-id does NOT match the reverse pid
      { match: 'patch-id', input: 'DIFF:unrelated', out: 'OTHERPID 0\n' },
    ])
    const signals = detectGitRejections(
      { identifier: 'LUM-901', shas: [DELIVERY] },
      run
    )
    expect(signals).toEqual([])
    expect(deriveDetectorVerdict(signals)).toBe('INCONCLUSIVE')
  })

  it('ignores revert-claiming prose without git-topology backing', () => {
    // A downstream commit whose MESSAGE claims a revert ("revert the LUM-587
    // change") but which carries NO `This reverts commit <sha>` trailer and whose
    // diff does not reverse the delivery. git's --grep on the trailer phrase does
    // not surface it, and the patch-id does not match → no signal. Wording alone
    // is never a rejection signal (573 red line).
    const PROSE = 'b'.repeat(40)
    const run = fakeGit([
      // trailer grep yields nothing — the prose commit lacks the trailer
      { match: 'This reverts commit', out: '' },
      { match: `diff ${DELIVERY} ${DELIVERY}^`, out: 'DIFF:rev' },
      { match: 'patch-id', input: 'DIFF:rev', out: 'PIDREV 0\n' },
      { match: `show ${DELIVERY} --numstat`, out: '3\t4\tlib/foo.ts\n' },
      { match: 'lib/foo.ts', out: `${PROSE}\n` },
      { match: `show --format= ${PROSE}`, out: 'DIFF:prose-claims-revert' },
      { match: 'patch-id', input: 'DIFF:prose-claims-revert', out: 'NOPE 0\n' },
    ])
    const signals = detectGitRejections(
      { identifier: 'LUM-587', shas: [DELIVERY] },
      run
    )
    expect(signals).toEqual([])
    expect(deriveDetectorVerdict(signals)).toBe('INCONCLUSIVE')
  })

  it('verdict space is exactly OUTCOME_VERDICTS with no SATISFIED branch', () => {
    // The detector's verdict is drawn from the shared well constant; there is no
    // SATISFIED/PASS — absence of a rejection stays INCONCLUSIVE.
    expect([...OUTCOME_VERDICTS].sort()).toEqual(['INCONCLUSIVE', 'REJECTED'])
    expect(OUTCOME_VERDICTS).not.toContain('SATISFIED')
    expect(OUTCOME_VERDICTS).not.toContain('PASS')

    const empty = deriveDetectorVerdict([])
    const nonEmpty = deriveDetectorVerdict([
      {
        kind: 'REVERTED',
        mechanism: 'revert-commit',
        revertingSha: REVERT,
        revertedSha: DELIVERY,
      },
    ])
    expect(empty).toBe('INCONCLUSIVE')
    expect(nonEmpty).toBe('REJECTED')
    expect(OUTCOME_VERDICTS).toContain(empty)
    expect(OUTCOME_VERDICTS).toContain(nonEmpty)
  })

  it('does not double-count a formal revert (trailer + patch-id) as two signals', () => {
    // A `git revert` commit is caught by the trailer detector; its patch-id also
    // matches the delivery's reverse. It must yield ONE signal, not two.
    const deliveryReverseDiff = 'DIFF:reverse'
    const PID = 'samepid'
    const run = fakeGit([
      {
        match: 'This reverts commit',
        out: `${REVERT}${FS}Revert x\n\nThis reverts commit ${DELIVERY}.\n${RS}`,
      },
      { match: `diff ${DELIVERY} ${DELIVERY}^`, out: deliveryReverseDiff },
      { match: 'patch-id', input: deliveryReverseDiff, out: `${PID} 0\n` },
      { match: `show ${DELIVERY} --numstat`, out: '3\t4\tlib/foo.ts\n' },
      { match: 'lib/foo.ts', out: `${REVERT}\n` },
      { match: `show --format= ${REVERT}`, out: 'DIFF:revert-body' },
      { match: 'patch-id', input: 'DIFF:revert-body', out: `${PID} 0\n` },
    ])
    const signals = detectGitRejections(
      { identifier: 'LUM-587', shas: [DELIVERY] },
      run
    )
    expect(signals).toHaveLength(1)
    expect(signals[0]!.mechanism).toBe('revert-commit')
  })
})
