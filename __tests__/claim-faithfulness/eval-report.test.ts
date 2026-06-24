/** @jest-environment node */
import { scoreEval } from '@/scripts/eval/claim-faithfulness/eval'

const ANCHORS = ['LUM-539', 'LUM-565', 'LUM-567', 'LUM-540', 'LUM-522']

describe('scoreEval', () => {
  it('counts correct verdicts and confirms anchors pass', () => {
    const rows = [
      { identifier: 'LUM-539', expected: 'FAITHFUL', actual: 'FAITHFUL' },
      { identifier: 'LUM-565', expected: 'FAITHFUL', actual: 'FAITHFUL' },
      { identifier: 'LUM-567', expected: 'FAITHFUL', actual: 'FAITHFUL' },
      { identifier: 'LUM-540', expected: 'UNDERREPORT', actual: 'UNDERREPORT' },
      { identifier: 'LUM-522', expected: 'FAITHFUL', actual: 'FAITHFUL' },
    ] as const
    const s = scoreEval([...rows], ANCHORS)
    expect(s.correct).toBe(5)
    expect(s.anchorsPassed).toBe(true)
  })
  it('fails the anchor gate when an anchor is misjudged', () => {
    const rows = [
      { identifier: 'LUM-540', expected: 'UNDERREPORT', actual: 'FAITHFUL' },
    ] as const
    expect(scoreEval([...rows], ANCHORS).anchorsPassed).toBe(false)
  })
})
