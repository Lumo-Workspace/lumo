import type { TaskStatus } from '@prisma/client'

/**
 * LUM-639 — milestone green-quality rollup (the "acceptance quality" audit
 * footnote of the outcome section).
 *
 * Counts over the milestone's DONE tasks, never a merged score: the claim
 * faithfulness (ClaimFaithfulnessVerdict) distribution. A task with no verdict
 * row, an UNJUDGEABLE verdict, or an unrecognized verdict string lands in the
 * explicit `unjudged` bucket — a first-class bucket, not a silent default.
 */

/** One DONE-task input row (parent extracts flat values — LoD). */
export interface GreenQualityTaskRow {
  id: string
  status: TaskStatus
  /** ClaimFaithfulnessVerdict.verdict, or null when never judged. */
  faithfulnessVerdict: string | null
}

export interface MilestoneGreenQuality {
  /** DONE tasks the rollup covers. */
  doneCount: number
  /** Task counts per faithfulness verdict; unjudged is explicit. */
  faithfulness: {
    faithful: number
    overstated: number
    underReported: number
    unjudged: number
  }
}

/**
 * Derive the green-quality footnote counts from DONE-task rows. Pure and
 * deterministic; non-DONE rows are ignored so callers can pass a milestone's
 * full task list without pre-filtering.
 */
export function computeMilestoneGreenQuality(
  rows: GreenQualityTaskRow[]
): MilestoneGreenQuality {
  const faithfulness = {
    faithful: 0,
    overstated: 0,
    underReported: 0,
    unjudged: 0,
  }

  let doneCount = 0
  for (const row of rows) {
    if (row.status !== 'DONE') continue
    doneCount += 1

    switch (row.faithfulnessVerdict) {
      case 'FAITHFUL':
        faithfulness.faithful += 1
        break
      case 'OVERSTATED':
        faithfulness.overstated += 1
        break
      case 'UNDERREPORT':
        faithfulness.underReported += 1
        break
      default:
        faithfulness.unjudged += 1
        break
    }
  }

  return { doneCount, faithfulness }
}
