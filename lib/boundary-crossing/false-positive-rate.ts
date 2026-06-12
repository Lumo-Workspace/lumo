/**
 * False-positive-rate measurement for boundary crossings (LUM-449, Phase 1-②).
 *
 * The dev-guardrail wedge (LUM-426/435/442) only survives if it stays LOW-noise:
 * a detector that keeps flagging normal operations as dangerous gets switched
 * off, and a switched-off guardrail catches nothing. This module turns the
 * HUMAN disposition feedback (LUM-435: every reviewed crossing is marked
 * FALSE_POSITIVE or CONFIRMED) into a per-category false-positive rate, so the
 * noisy categories can be named and tightened — strictly measure-first
 * (mirrors LUM-403/436/438): it only computes, it reads no data of its own, and
 * the denoise that follows is gated on this evidence, never a blind tuning.
 *
 * This file is a PURE core: it takes the dispositioned rows as input and owns no
 * I/O, so it can be unit-tested without a database and reused by the runnable
 * harness (`scripts/boundary-fp-rate.ts`) which supplies the (read-only) rows.
 *
 * Honest sparse-data handling (the load-bearing discipline). A freshly-launched
 * detector has very few human dispositions. A category with two FALSE_POSITIVE
 * rows is not "100% noise"; a category with one CONFIRMED row is not "0% noise".
 * Reporting those proportions would be worse than reporting nothing — it invites
 * a blind over-tightening that breaks true detection. So any category below
 * {@link DEFAULT_MIN_SAMPLES} dispositions is reported as `insufficient` with a
 * null rate; the raw counts are still surfaced (the data exists, it is just too
 * thin to divide into a believable rate).
 */

/** A single human-dispositioned crossing — the only input this module needs. */
export interface DispositionedCrossing {
  /** BoundaryCrossingCategory (kept as a plain string so the pure core carries
   *  no Prisma import; the harness passes the enum value through verbatim). */
  category: string
  /** A non-null disposition: FALSE_POSITIVE or CONFIRMED. Open (null) crossings
   *  are not dispositions and must be filtered out before this module sees them. */
  disposition: 'FALSE_POSITIVE' | 'CONFIRMED'
}

/**
 * Minimum human dispositions a category needs before its false-positive rate is
 * trustworthy enough to report. Below this the rate is suppressed as
 * `insufficient` rather than shown as a misleading 0%/100%.
 *
 * Chosen at 10 as a pragmatic early-warning floor, not a statistical guarantee:
 * the 95% confidence interval on a proportion estimated from <10 samples is so
 * wide (e.g. 2/2 → a true rate anywhere from ~34% to 100%) that acting on it
 * would be guessing. 10 is the smallest round number where a single flipped
 * disposition moves the rate by ≤10 points, so a named "noisy" category reflects
 * a trend rather than one reviewer's call. It is overridable per-run so the
 * threshold stays a visible, debatable knob (the task left it open on purpose).
 */
export const DEFAULT_MIN_SAMPLES = 10

/** One category's false-positive picture. */
export interface CategoryFalsePositiveRate {
  category: string
  /** Total dispositioned crossings (FALSE_POSITIVE + CONFIRMED). */
  dispositioned: number
  falsePositives: number
  confirmed: number
  /** `measured` when `dispositioned >= minSamples`, else `insufficient`. */
  status: 'measured' | 'insufficient'
  /** FALSE_POSITIVE ÷ dispositioned in [0,1] when `measured`; `null` when
   *  `insufficient` (never a misleading rate off too few samples). */
  falsePositiveRate: number | null
}

export interface FalsePositiveReport {
  /** The sample threshold this report was computed with (echoed for honesty). */
  minSamples: number
  /** Per category, sorted: measured categories first by descending FP rate (the
   *  noisiest on top — what a denoise pass would name), then insufficient ones
   *  alphabetically. */
  categories: CategoryFalsePositiveRate[]
}

interface Tally {
  falsePositives: number
  confirmed: number
}

/**
 * Compute the per-category false-positive rate from human dispositions. Pure:
 * no I/O, no mutation of the input. A category below `minSamples` dispositions
 * is reported `insufficient` with a null rate.
 */
export function computeFalsePositiveRates(
  crossings: DispositionedCrossing[],
  options: { minSamples?: number } = {}
): FalsePositiveReport {
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES

  const tallies = new Map<string, Tally>()
  for (const { category, disposition } of crossings) {
    const t = tallies.get(category) ?? { falsePositives: 0, confirmed: 0 }
    if (disposition === 'FALSE_POSITIVE') t.falsePositives++
    else t.confirmed++
    tallies.set(category, t)
  }

  const categories: CategoryFalsePositiveRate[] = []
  for (const [category, t] of tallies) {
    const dispositioned = t.falsePositives + t.confirmed
    const sufficient = dispositioned >= minSamples
    categories.push({
      category,
      dispositioned,
      falsePositives: t.falsePositives,
      confirmed: t.confirmed,
      status: sufficient ? 'measured' : 'insufficient',
      // Guard the division behind the sufficiency check: an insufficient (incl.
      // zero) category never reaches it, so no NaN/Infinity and no misleading
      // 0%/100% off a thin sample.
      falsePositiveRate: sufficient ? t.falsePositives / dispositioned : null,
    })
  }

  categories.sort(compareCategories)
  return { minSamples, categories }
}

/** Measured (by descending FP rate) above insufficient; ties broken by name. */
function compareCategories(
  a: CategoryFalsePositiveRate,
  b: CategoryFalsePositiveRate
): number {
  if (a.status !== b.status) return a.status === 'measured' ? -1 : 1
  if (a.status === 'measured') {
    const byRate = (b.falsePositiveRate ?? 0) - (a.falsePositiveRate ?? 0)
    if (byRate !== 0) return byRate
  }
  return a.category.localeCompare(b.category)
}

/** Render a report for stdout (the runnable harness prints this). */
export function formatReport(report: FalsePositiveReport): string {
  const lines: string[] = []
  lines.push(
    `Boundary-crossing false-positive rates (min ${report.minSamples} dispositions per category)`
  )
  if (report.categories.length === 0) {
    lines.push('  (no human-dispositioned crossings yet — nothing to measure)')
    return lines.join('\n') + '\n'
  }
  for (const c of report.categories) {
    if (c.status === 'measured') {
      const pct = ((c.falsePositiveRate ?? 0) * 100).toFixed(1)
      lines.push(
        `  ${c.category}: ${pct}% false-positive ` +
          `(${c.falsePositives} FP / ${c.dispositioned} dispositioned, ${c.confirmed} confirmed)`
      )
    } else {
      lines.push(
        `  ${c.category}: insufficient data ` +
          `(${c.dispositioned} dispositioned < ${report.minSamples} — rate withheld)`
      )
    }
  }
  return lines.join('\n') + '\n'
}
