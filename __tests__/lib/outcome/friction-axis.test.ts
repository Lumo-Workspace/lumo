import {
  computeFriction,
  deriveFrictionBucket,
  FRICTION_BUCKETS,
  type VerificationRunRow,
} from '@/lib/outcome/friction'

/**
 * LUM-606 — verification-friction trust axis. These tests pin the three hard
 * rules as gates (cut at capturedAt, no-verification is its own bucket, no
 * direction welded) plus the two structural invariants (two separate scalars,
 * deterministic replay). Titles match the locked MACHINE checkpointers verbatim.
 */

const at = (s: string) => new Date(s)
const run = (
  round: number,
  verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP',
  createdAt: string
): VerificationRunRow => ({ round, verdict, createdAt: at(createdAt) })

const CAP = at('2026-06-20T12:00:00Z')

describe('friction axis', () => {
  it('cut at capturedAt: rows after capturedAt are excluded', () => {
    const runs = [
      run(1, 'FAIL', '2026-06-20T10:00:00Z'), // before — counts
      run(2, 'PASS', '2026-06-20T11:00:00Z'), // before — counts
      run(3, 'FAIL', '2026-06-21T09:00:00Z'), // after  — excluded
    ]
    expect(computeFriction(runs, CAP)).toEqual({
      verificationRounds: 2,
      sendBackCount: 1,
    })
  })

  it('no-verification bucket is separate: zero rows before capturedAt → null, bucketed no-verification not single-round', () => {
    const runs = [run(1, 'PASS', '2026-06-21T09:00:00Z')] // all after cut
    const f = computeFriction(runs, CAP)
    expect(f).toEqual({ verificationRounds: null, sendBackCount: null })
    expect(deriveFrictionBucket(f.verificationRounds, f.sendBackCount)).toBe(
      'no-verification'
    )
    // contrast: a real single-round is NOT no-verification (absence ≠ a clean pass)
    expect(deriveFrictionBucket(1, 0)).toBe('single-round')
  })

  it('no direction welded: bucketer returns only descriptive labels, no score/ordering', () => {
    expect(new Set(FRICTION_BUCKETS)).toEqual(
      new Set(['no-verification', 'single-round', 'multi-round-or-sendback'])
    )
    // a multi-round and a send-back both land in the SAME bucket — the bucketer
    // ranks neither above the other; direction is left to the correlation.
    expect(deriveFrictionBucket(3, 0)).toBe('multi-round-or-sendback')
    expect(deriveFrictionBucket(1, 2)).toBe('multi-round-or-sendback')
  })

  it('rounds and sendBacks frozen as separate scalars: computeFriction returns two distinct keys, never merged', () => {
    const f = computeFriction([run(2, 'FAIL', '2026-06-20T10:00:00Z')], CAP)
    expect(Object.keys(f).sort()).toEqual([
      'sendBackCount',
      'verificationRounds',
    ])
    expect(f.verificationRounds).toBe(2)
    expect(f.sendBackCount).toBe(1)
    // PASS_WITH_FOLLOWUP is not a send-back — only an explicit FAIL verdict is.
    const g = computeFriction(
      [run(1, 'PASS_WITH_FOLLOWUP', '2026-06-20T10:00:00Z')],
      CAP
    )
    expect(g).toEqual({ verificationRounds: 1, sendBackCount: 0 })
  })

  it('deterministic replay from append-only rows: same rows → same output, order-independent', () => {
    const rows = [
      run(2, 'PASS', '2026-06-20T11:00:00Z'),
      run(1, 'FAIL', '2026-06-20T10:00:00Z'),
    ]
    const a = computeFriction(rows, CAP)
    const b = computeFriction([...rows].reverse(), CAP)
    expect(a).toEqual(b)
    expect(a).toEqual({ verificationRounds: 2, sendBackCount: 1 })
  })
})
