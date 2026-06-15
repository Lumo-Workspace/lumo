/** @jest-environment node */
import { deriveSendBackResolution } from '@/lib/services/send-back-lifecycle'

type Run = {
  criterionId: string
  round: number
  verdict: 'PASS' | 'FAIL'
  verifierType: 'HUMAN' | 'AGENT' | 'MACHINE'
  createdAt: Date
}
const run = (o: Partial<Run>): Run => ({
  criterionId: 'c1',
  round: 1,
  verdict: 'FAIL',
  verifierType: 'AGENT',
  createdAt: new Date('2026-06-01'),
  ...o,
})
const prs = [
  { number: 7, url: 'http://pr/7', createdAt: new Date('2026-06-02') },
]

describe('deriveSendBackResolution', () => {
  it('marks resolved when a HUMAN/AGENT FAIL is later PASSed, with the in-window PR', () => {
    const runs = [
      run({ round: 1, verdict: 'FAIL', createdAt: new Date('2026-06-01') }),
      run({ round: 2, verdict: 'PASS', createdAt: new Date('2026-06-03') }),
    ]
    expect(deriveSendBackResolution('c1', runs, prs)).toEqual({
      status: 'resolved',
      failedAtRound: 1,
      resolvedAtRound: 2,
      closingPrNumber: 7,
      closingPrUrl: 'http://pr/7',
    })
  })

  it('marks open when the latest verdict is still FAIL', () => {
    const runs = [run({ round: 1, verdict: 'FAIL' })]
    expect(deriveSendBackResolution('c1', runs, prs)).toEqual({
      status: 'open',
      failedAtRound: 1,
    })
  })

  it('returns null when the criterion was never sent back (no HUMAN/AGENT FAIL)', () => {
    const runs = [run({ round: 1, verdict: 'PASS', verifierType: 'MACHINE' })]
    expect(deriveSendBackResolution('c1', runs, prs)).toBeNull()
  })

  it('ignores a MACHINE-only FAIL (verify loop, not a send-back)', () => {
    const runs = [
      run({ round: 1, verdict: 'FAIL', verifierType: 'MACHINE' }),
      run({ round: 2, verdict: 'PASS', verifierType: 'MACHINE' }),
    ]
    expect(deriveSendBackResolution('c1', runs, prs)).toBeNull()
  })

  it('omits the PR when none falls in the window', () => {
    const runs = [
      run({ round: 1, verdict: 'FAIL', createdAt: new Date('2026-06-05') }),
      run({ round: 2, verdict: 'PASS', createdAt: new Date('2026-06-06') }),
    ]
    const r = deriveSendBackResolution('c1', runs, prs)
    expect(r).toMatchObject({ status: 'resolved' })
    expect(r?.closingPrNumber).toBeUndefined()
  })
})
