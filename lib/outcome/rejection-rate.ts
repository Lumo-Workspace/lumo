/**
 * LUM-603 — the trust × post-hoc-fate join, at the query layer.
 *
 * The question: do high-"trust" deliveries get REJECTED by reality less often
 * than low-"trust" ones? "Trust" here is the delivery-time forecast-confidence
 * bracket — the only trust axis FROZEN at delivery (TaskForecastSnapshot's
 * cohortSize / tokenCostBasis, LUM-319), recomputed via {@link deriveConfidence}
 * so the bracket is fully replayable and never reads a drifted current value.
 * (Fragment-level trust is NOT frozen and drifts; joining it would use the
 * wrong, post-hoc value — that is debt-a, deliberately deferred, not done here.)
 *
 * This is a PURE core (mirrors lib/boundary-crossing/false-positive-rate.ts): it
 * owns no I/O and takes the already-joined deliveries as input, so it unit-tests
 * without a database and is reused by the service that supplies the rows.
 *
 * The load-bearing discipline is the task's own 铁律 expressed at the query
 * layer — falsifier, not verifier:
 *
 *  1. A bracket below {@link DEFAULT_MIN_SAMPLES} deliveries is reported
 *     `insufficient` with a null rate. Two deliveries, one reverted, is not a
 *     "50% rejection rate"; reporting that invites a false correlation.
 *  2. The rejection rate is an explicit LOWER BOUND on true failure. The well
 *     only records rejections; a delivery with zero signals is INCONCLUSIVE
 *     (genuinely-good / merely-tolerated / never-noticed are indistinguishable),
 *     never "satisfied". So `rejected / delivered` undercounts true failures and
 *     is labelled as a floor, not the answer.
 *  3. The high-vs-low comparison asserts a direction ONLY when both brackets are
 *     measured AND their 95% confidence intervals are disjoint. Overlapping
 *     intervals → `inconclusive`, no direction. The query never claims a
 *     correlation the sample cannot support.
 */

import { deriveConfidence } from '@/lib/forecast/confidence'
import type { ForecastConfidence } from '@/lib/forecast/types'

/** One delivery joined to its post-hoc fate — the only input this module needs. */
export interface DeliveryOutcome {
  /** Forecast-confidence sample sizes FROZEN at delivery in TaskForecastSnapshot
   *  (cohortSize, tokenCostBasis). The bracket is recomputed from these via
   *  deriveConfidence — never read from a live/current or fragment trust value. */
  confidenceSamples: number[]
  /** Whether the post-hoc well holds >=1 rejection signal for this delivery
   *  (REJECTED) vs none (INCONCLUSIVE). Derived from signal COUNT upstream,
   *  never from any agent-supplied verdict. */
  rejected: boolean
}

/**
 * Minimum deliveries a confidence bracket needs before its rejection rate is
 * reported. Below this the rate is suppressed as `insufficient` (the raw counts
 * still shown) rather than divided into a believable proportion. Mirrors the
 * boundary-crossing FP-rate floor (LUM-449): the 95% CI on a proportion from
 * <10 samples is so wide that acting on it is guessing. Overridable per call.
 */
export const DEFAULT_MIN_SAMPLES = 10

/** High → low, the order brackets render in (most-trusted delivery first). */
export const TRUST_BRACKETS: readonly ForecastConfidence[] = [
  'high',
  'medium',
  'low',
] as const

/** A 95% Wilson score interval on a proportion, both ends clamped to [0,1]. */
export interface ConfidenceInterval {
  lower: number
  upper: number
}

/** One confidence bracket's post-hoc rejection picture. */
export interface BracketRejection {
  bracket: ForecastConfidence
  /** Deliveries snapshotted in this bracket — the rate denominator. Includes
   *  zero-signal (INCONCLUSIVE) deliveries: absence of rejection is not absence
   *  from the sample. */
  delivered: number
  /** Deliveries the well rejected (>=1 signal). */
  rejected: number
  /** `measured` when `delivered >= minSamples`, else `insufficient`. */
  status: 'measured' | 'insufficient'
  /** rejected ÷ delivered in [0,1] when `measured`; `null` when `insufficient`.
   *  A LOWER BOUND on true failure — INCONCLUSIVE deliveries may hide failures
   *  the well has not (yet) seen. Never a "pass" rate. */
  rejectionRate: number | null
  /** 95% Wilson interval on `rejectionRate` when `measured`, else `null`. */
  interval: ConfidenceInterval | null
}

export type ComparisonStatus = 'measured' | 'inconclusive'
export type ComparisonDirection = 'high-rejected-more' | 'low-rejected-more'

/** The headline high-vs-low read — the only place a directional claim is made. */
export interface OutcomeRejectionComparison {
  status: ComparisonStatus
  /** Set ONLY when `status === 'measured'` (both brackets measured, CIs
   *  disjoint); `null` whenever the sample cannot support a direction. */
  direction: ComparisonDirection | null
  /** Plain-language why — names the bracket(s) too thin, or the CI overlap. */
  reason: string
}

export interface OutcomeRejectionReport {
  minSamples: number
  totalDeliveries: number
  /** Per bracket, ordered high → medium → low. */
  brackets: BracketRejection[]
  comparison: OutcomeRejectionComparison
}

const Z = 1.96 // 95% two-sided normal quantile

/** Wilson score interval — well-behaved at the extremes and on small n. */
function wilsonInterval(rejected: number, n: number): ConfidenceInterval {
  if (n === 0) return { lower: 0, upper: 0 }
  const p = rejected / n
  const z2 = Z * Z
  const denom = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denom
  const half = (Z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / denom
  return {
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
  }
}

/** Disjoint = the two intervals do not overlap at all. */
function disjoint(a: ConfidenceInterval, b: ConfidenceInterval): boolean {
  return a.upper < b.lower || b.upper < a.lower
}

/**
 * Compute the per-bracket post-hoc rejection rate and the high-vs-low read.
 * Pure: no I/O, no mutation of the input. A bracket below `minSamples` is
 * `insufficient` with a null rate; the comparison stays `inconclusive` unless
 * both brackets are measured and their CIs are disjoint.
 */
export function computeOutcomeRejectionRate(
  deliveries: DeliveryOutcome[],
  options: { minSamples?: number } = {}
): OutcomeRejectionReport {
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES

  const tallies = new Map<
    ForecastConfidence,
    { delivered: number; rejected: number }
  >()
  for (const d of deliveries) {
    const b = deriveConfidence(d.confidenceSamples)
    const t = tallies.get(b) ?? { delivered: 0, rejected: 0 }
    t.delivered++
    if (d.rejected) t.rejected++
    tallies.set(b, t)
  }

  const brackets: BracketRejection[] = TRUST_BRACKETS.map(bracket => {
    const t = tallies.get(bracket) ?? { delivered: 0, rejected: 0 }
    const measured = t.delivered >= minSamples
    return {
      bracket,
      delivered: t.delivered,
      rejected: t.rejected,
      status: measured ? 'measured' : 'insufficient',
      // Guard the division behind the sufficiency check: a thin (incl. empty)
      // bracket never reaches it, so no misleading 0%/100% off too few samples.
      rejectionRate: measured ? t.rejected / t.delivered : null,
      interval: measured ? wilsonInterval(t.rejected, t.delivered) : null,
    }
  })

  return {
    minSamples,
    totalDeliveries: deliveries.length,
    brackets,
    comparison: compareHighVsLow(brackets),
  }
}

/** The falsifier-disciplined high-vs-low read. */
function compareHighVsLow(
  brackets: BracketRejection[]
): OutcomeRejectionComparison {
  const high = brackets.find(b => b.bracket === 'high')!
  const low = brackets.find(b => b.bracket === 'low')!

  const thin = [high, low].filter(b => b.status !== 'measured')
  if (thin.length > 0) {
    return {
      status: 'inconclusive',
      direction: null,
      reason: `not enough data to compare (${thin
        .map(
          b =>
            `${b.bracket} bracket has ${b.delivered} deliveries, below the floor`
        )
        .join('; ')})`,
    }
  }

  if (
    !high.interval ||
    !low.interval ||
    !disjoint(high.interval, low.interval)
  ) {
    return {
      status: 'inconclusive',
      direction: null,
      reason:
        'confidence intervals overlap — the sample cannot tell the two brackets apart',
    }
  }

  const direction: ComparisonDirection =
    (high.rejectionRate ?? 0) > (low.rejectionRate ?? 0)
      ? 'high-rejected-more'
      : 'low-rejected-more'
  return {
    status: 'measured',
    direction,
    reason:
      direction === 'low-rejected-more'
        ? 'low-trust deliveries were rejected more often (intervals disjoint)'
        : 'high-trust deliveries were rejected more often (intervals disjoint)',
  }
}

/** Render a report for stdout (the CLI prints this). */
export function formatOutcomeRejectionReport(
  report: OutcomeRejectionReport
): string {
  const lines: string[] = []
  lines.push(
    `Trust × post-hoc fate — delivery-time forecast confidence vs the outcome well`
  )
  lines.push(
    `  (rejection rate is a LOWER BOUND: the well only records rejections; ` +
      `no signal = INCONCLUSIVE, never "satisfied")`
  )
  lines.push(
    `  ${report.totalDeliveries} snapshotted deliveries · min ${report.minSamples} per bracket`
  )
  if (report.totalDeliveries === 0) {
    lines.push('  (no delivery has a forecast snapshot yet — nothing to join)')
    return lines.join('\n') + '\n'
  }
  for (const b of report.brackets) {
    if (b.status === 'measured') {
      const pct = ((b.rejectionRate ?? 0) * 100).toFixed(1)
      const lo = ((b.interval?.lower ?? 0) * 100).toFixed(1)
      const hi = ((b.interval?.upper ?? 0) * 100).toFixed(1)
      lines.push(
        `  ${b.bracket.padEnd(6)} ≥${pct}% rejected ` +
          `(${b.rejected}/${b.delivered}, 95% CI ${lo}–${hi}%)`
      )
    } else {
      lines.push(
        `  ${b.bracket.padEnd(6)} insufficient ` +
          `(${b.rejected}/${b.delivered} deliveries < ${report.minSamples} — rate withheld)`
      )
    }
  }
  if (report.comparison.status === 'measured') {
    lines.push(`  → ${report.comparison.reason}`)
  } else {
    lines.push(`  → inconclusive: ${report.comparison.reason}`)
  }
  return lines.join('\n') + '\n'
}
