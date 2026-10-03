import {
  computeMilestoneGreenQuality,
  type GreenQualityTaskRow,
} from '@/lib/summaries/milestone-green-quality'

function row(overrides: Partial<GreenQualityTaskRow>): GreenQualityTaskRow {
  return {
    id: 't-1',
    status: 'DONE',
    faithfulnessVerdict: null,
    ...overrides,
  }
}

describe('computeMilestoneGreenQuality', () => {
  it('green quality buckets are explicit and never scored', () => {
    const result = computeMilestoneGreenQuality([
      // Never judged — the explicit unjudged bucket, not a silent default.
      row({ id: 'a' }),
      row({ id: 'b', faithfulnessVerdict: 'FAITHFUL' }),
      row({ id: 'c', faithfulnessVerdict: 'OVERSTATED' }),
      row({ id: 'd', faithfulnessVerdict: 'UNDERREPORT' }),
      // UNJUDGEABLE and unknown verdict strings are explicit unjudged, never
      // silently folded into a judged bucket.
      row({ id: 'e', faithfulnessVerdict: 'UNJUDGEABLE' }),
      row({ id: 'f', faithfulnessVerdict: 'SOMETHING_NEW' }),
      // Non-DONE rows are ignored entirely.
      row({ id: 'g', status: 'IN_PROGRESS', faithfulnessVerdict: 'FAITHFUL' }),
    ])

    // Exact shape — counts only. No rate, no score, no synthesized third state.
    expect(result).toEqual({
      doneCount: 6,
      faithfulness: {
        faithful: 1,
        overstated: 1,
        underReported: 1,
        unjudged: 3,
      },
    })
    const serialized = JSON.stringify(result).toLowerCase()
    for (const forbidden of ['score', 'rate', 'ratio', 'health', 'satisfied']) {
      expect(serialized).not.toContain(forbidden)
    }
  })

  it('an empty milestone yields zero counts, not a missing block', () => {
    expect(computeMilestoneGreenQuality([])).toEqual({
      doneCount: 0,
      faithfulness: {
        faithful: 0,
        overstated: 0,
        underReported: 0,
        unjudged: 0,
      },
    })
  })
})
