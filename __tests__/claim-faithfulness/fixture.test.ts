/** @jest-environment node */
import {
  GOLD_SET,
  EXPECTED_ANCHORS,
} from '@/scripts/eval/claim-faithfulness/fixture'

describe('gold set', () => {
  it('contains every named anchor with its locked label', () => {
    for (const [id, label] of Object.entries(EXPECTED_ANCHORS)) {
      expect(GOLD_SET.find(r => r.identifier === id)?.label).toBe(label)
    }
  })
  it('has at least the 5 anchors plus expansion rows', () => {
    expect(GOLD_SET.length).toBeGreaterThanOrEqual(5)
  })
  it('uses only valid verdict labels', () => {
    const valid = new Set([
      'FAITHFUL',
      'UNDERREPORT',
      'OVERSTATED',
      'UNJUDGEABLE',
    ])
    GOLD_SET.forEach(r => expect(valid.has(r.label)).toBe(true))
  })
  it('has no duplicate identifiers', () => {
    const ids = GOLD_SET.map(r => r.identifier)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
