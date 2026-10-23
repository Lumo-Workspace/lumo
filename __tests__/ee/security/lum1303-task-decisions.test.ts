/** @jest-environment node */
import {
  extractTaskDecisions,
  TASK_REQUIREMENTS_MAX,
} from '@/ee/security/security-scan/issue-assessment'

describe('extractTaskDecisions with recorded rows (LUM-1303)', () => {
  it('reads table rows, appending the rationale', () => {
    expect(
      extractTaskDecisions(null, [
        { text: 'keep v1', rationale: 'v2 is separate' },
        { text: 'ship', rationale: null },
      ])
    ).toEqual(['keep v1 — why: v2 is separate', 'ship'])
  })

  it('puts a not-yet-backfilled description section first, as the older lines', () => {
    expect(
      extractTaskDecisions('## Decisions\n\n- old one\n', [
        { text: 'new one', rationale: null },
      ])
    ).toEqual(['old one', 'new one'])
  })

  it('keeps only the newest when over the cap', () => {
    const rows = Array.from({ length: TASK_REQUIREMENTS_MAX + 3 }, (_, i) => ({
      text: `d${i}`,
      rationale: null,
    }))
    const out = extractTaskDecisions(null, rows)
    expect(out).toHaveLength(TASK_REQUIREMENTS_MAX)
    expect(out[out.length - 1]).toBe(`d${TASK_REQUIREMENTS_MAX + 2}`)
    expect(out[0]).toBe('d3')
  })
})
