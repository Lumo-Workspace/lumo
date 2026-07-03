import type { TaskStatus } from '@prisma/client'
import { deriveFrictionBucket } from '../outcome/friction'
import {
  groundingComposition,
  type SnapshotCriterionShape,
} from '../fidelity/change-pattern'

/**
 * LUM-639 — milestone green-quality rollup (the "acceptance quality" audit
 * footnote of the outcome section).
 *
 * Three count groups over the milestone's DONE tasks, never a merged score:
 *  1. verification friction — per-task bucket via the SAME
 *     `deriveFrictionBucket` the workspace-level `lumo outcome rate`
 *     (LUM-606) uses, over the two scalars frozen on TaskForecastSnapshot.
 *     A missing snapshot or null scalars is the explicit no-verification
 *     bucket, NEVER folded into single-round (silence is not a clean pass).
 *  2. claim faithfulness — ClaimFaithfulnessVerdict distribution. A task with
 *     no verdict row, an UNJUDGEABLE verdict, or an unrecognized verdict
 *     string lands in the explicit `unjudged` bucket — a first-class bucket,
 *     not a silent default.
 *  3. criteria referent kind — grounding composition of the LUM-609
 *     delivery-time frozen contract via the SAME `groundingComposition`
 *     `lumo fidelity show` uses; counts CRITERIA, while `noSnapshotTasks`
 *     counts TASKS whose delivery froze no contract (explicit, not dropped).
 */

/** One DONE-task input row (parent extracts flat values — LoD). */
export interface GreenQualityTaskRow {
  id: string
  status: TaskStatus
  /** TaskForecastSnapshot.verificationRounds; null = no verification record. */
  verificationRounds: number | null
  /** TaskForecastSnapshot.sendBackCount; null = no verification record. */
  sendBackCount: number | null
  /** ClaimFaithfulnessVerdict.verdict, or null when never judged. */
  faithfulnessVerdict: string | null
  /** Latest frozen contract's criteria; null = no TaskCriteriaSnapshot row. */
  snapshotCriteria: SnapshotCriterionShape[] | null
}

export interface MilestoneGreenQuality {
  /** DONE tasks the rollup covers. */
  doneCount: number
  /** Task counts per LUM-606 friction bucket (bucket names shared verbatim). */
  friction: {
    noVerification: number
    singleRound: number
    multiRoundOrSendback: number
  }
  /** Task counts per faithfulness verdict; unjudged is explicit. */
  faithfulness: {
    faithful: number
    overstated: number
    underReported: number
    unjudged: number
  }
  /** CRITERIA counts per LUM-609 grounding bucket + the task-level gap. */
  referentKind: {
    externallyAnchored: number
    selfConfirming: number
    other: number
    /** Tasks (not criteria) whose delivery froze no contract snapshot. */
    noSnapshotTasks: number
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
  const friction = {
    noVerification: 0,
    singleRound: 0,
    multiRoundOrSendback: 0,
  }
  const faithfulness = {
    faithful: 0,
    overstated: 0,
    underReported: 0,
    unjudged: 0,
  }
  const referentKind = {
    externallyAnchored: 0,
    selfConfirming: 0,
    other: 0,
    noSnapshotTasks: 0,
  }

  let doneCount = 0
  for (const row of rows) {
    if (row.status !== 'DONE') continue
    doneCount += 1

    switch (deriveFrictionBucket(row.verificationRounds, row.sendBackCount)) {
      case 'no-verification':
        friction.noVerification += 1
        break
      case 'single-round':
        friction.singleRound += 1
        break
      case 'multi-round-or-sendback':
        friction.multiRoundOrSendback += 1
        break
    }

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

    if (row.snapshotCriteria === null) {
      referentKind.noSnapshotTasks += 1
    } else {
      const grounding = groundingComposition(row.snapshotCriteria)
      referentKind.externallyAnchored += grounding.grounded
      referentKind.selfConfirming += grounding.selfConfirming
      referentKind.other += grounding.inconclusive
    }
  }

  return { doneCount, friction, faithfulness, referentKind }
}
