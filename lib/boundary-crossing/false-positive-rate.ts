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

/** A single dispositioned crossing — the only input this module needs. */
export interface DispositionedCrossing {
  /** BoundaryCrossingCategory (kept as a plain string so the pure core carries
   *  no Prisma import; the harness passes the enum value through verbatim). */
  category: string
  /** A non-null disposition. FALSE_POSITIVE / CONFIRMED are HUMAN rulings and the
   *  only ones that feed the false-positive RATE. AUTO_LEGIT (LUM-478) is a SYSTEM
   *  auto-resolution — it is counted and surfaced per category (so an auto-release
   *  drift can never hide) but kept OUT of the FP-rate denominator, which measures
   *  human-disposition noise. Open (null) crossings are not dispositions and must
   *  be filtered out before this module sees them. AUTO_SUPPRESSED (LUM-751,
   *  a human-authored repository rule applied by the system) is likewise
   *  counted per category but kept out of the human FP-rate denominator. */
  disposition: 'FALSE_POSITIVE' | 'CONFIRMED' | 'AUTO_LEGIT' | 'AUTO_SUPPRESSED'
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
  /** HUMAN-dispositioned crossings (FALSE_POSITIVE + CONFIRMED) — the FP-rate
   *  denominator. AUTO_LEGIT is excluded here (it is a system call, not a human
   *  noise signal); see `autoLegit`. */
  dispositioned: number
  falsePositives: number
  confirmed: number
  /** System AUTO_LEGIT auto-resolutions (LUM-478) — surfaced so an auto-release
   *  volume is always visible and can never silently drift, but kept out of the
   *  human FP rate above. */
  autoLegit: number
  /** System AUTO_SUPPRESSED rule applications (LUM-751) — surfaced per category
   *  so a rule that silently eats a whole class is visible; never in the rate. */
  autoSuppressed: number
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
  autoLegit: number
  autoSuppressed: number
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
    const t = tallies.get(category) ?? {
      falsePositives: 0,
      confirmed: 0,
      autoLegit: 0,
      autoSuppressed: 0,
    }
    if (disposition === 'FALSE_POSITIVE') t.falsePositives++
    else if (disposition === 'AUTO_LEGIT') t.autoLegit++
    else if (disposition === 'AUTO_SUPPRESSED') t.autoSuppressed++
    else t.confirmed++
    tallies.set(category, t)
  }

  const categories: CategoryFalsePositiveRate[] = []
  for (const [category, t] of tallies) {
    // Human dispositions only — a system AUTO_LEGIT is tracked but never enters
    // the FP rate (it carries no human-noise signal).
    const dispositioned = t.falsePositives + t.confirmed
    const sufficient = dispositioned >= minSamples
    categories.push({
      category,
      dispositioned,
      falsePositives: t.falsePositives,
      confirmed: t.confirmed,
      autoLegit: t.autoLegit,
      autoSuppressed: t.autoSuppressed,
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
    // LUM-478: always echo the system auto-legit volume so an auto-release drift
    // is visible alongside (but never folded into) the human FP rate.
    const auto =
      (c.autoLegit > 0 ? `, ${c.autoLegit} auto-legit` : '') +
      (c.autoSuppressed > 0 ? `, ${c.autoSuppressed} auto-suppressed` : '')
    if (c.status === 'measured') {
      const pct = ((c.falsePositiveRate ?? 0) * 100).toFixed(1)
      lines.push(
        `  ${c.category}: ${pct}% false-positive ` +
          `(${c.falsePositives} FP / ${c.dispositioned} dispositioned, ${c.confirmed} confirmed${auto})`
      )
    } else {
      lines.push(
        `  ${c.category}: insufficient data ` +
          `(${c.dispositioned} dispositioned < ${report.minSamples} — rate withheld${auto})`
      )
    }
  }
  return lines.join('\n') + '\n'
}
