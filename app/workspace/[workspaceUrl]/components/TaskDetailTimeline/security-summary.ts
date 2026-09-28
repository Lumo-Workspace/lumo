/**
 * LUM-496 Task 3: pure derivations behind the Record tab's security-scan
 * section — the one-line rollup (PR count · undispositioned findings ·
 * all-LOW note · incomplete-scan count · external-failure count) and which PR
 * rows default open.
 * No intl, no React — unit-testable on their own.
 */
import type { SecurityScanView } from '@/lib/services/pr-security-scan.service'

export interface SecurityScanSummary {
  prs: number
  /** Undispositioned findings across every PR's latest scan. */
  findings: number
  /** True only when there is at least one undispositioned finding and every
   *  one of them is LOW severity — never true on zero findings (LUM-566: a
   *  clean result never reads as "reviewed and fine"). */
  allLow: boolean
  /** Latest scans whose external stage FAILED. */
  externalFailed: number
  /**
   * PRs whose latest scan cannot back a "no findings" claim: no scan at all,
   * or a scan the service marked `complete: false` (FAILED, a failed /
   * unconfigured / partial layer, or a truncated budget). LUM-496 review F1 —
   * without this the summary line read "7 PRs · no findings" while half the
   * scans never finished.
   *
   * LUM-832: excludes the scans counted in `overSizeLimit` — those did not
   * leave anything "for later"; a layer was skipped because the change was
   * too large, and saying "not fully checked yet" implied otherwise.
   */
  incomplete: number
  /**
   * LUM-832 — PRs whose latest scan skipped a layer ONLY because the change
   * was over its size cap (like CodeRabbit's limit): told as such, never as
   * "not fully checked yet" (nothing is coming later).
   */
  overSizeLimit: number
  /**
   * LUM-892 — PRs whose latest scan had a layer turned off in the workspace
   * settings (and nothing of ours unfinished): the customer's choice, told as
   * such — never "not fully checked yet", never clean.
   */
  turnedOff: number
}

/**
 * LUM-832 — the scan is unfinished only because a layer was over its size
 * cap: not ours to finish (`ownedUnfinished` is false) and a size notice is
 * on it. The one rule the summary line and the PR badge share.
 */
export function isOverSizeLimitOnly(
  scan: Pick<
    SecurityScanView,
    'coverage' | 'ownedUnfinished' | 'huntOverCap' | 'judgeOverCap'
  >
): boolean {
  return (
    scan.coverage === 'UNFINISHED' &&
    !scan.ownedUnfinished &&
    (scan.huntOverCap != null || scan.judgeOverCap != null)
  )
}

/** Undispositioned, not already on main, and still in the queue (LUM-775). */
function isOpenFinding(f: SecurityScanView['findings'][number]): boolean {
  return f.disposition == null && !f.persisting && f.queueExit == null
}

export function summarizeSecurityScans(
  prs: Array<{ latest: SecurityScanView | null }>
): SecurityScanSummary {
  // LUM-738: a persisting row (already on the default branch) needs no
  // decision from this PR's reviewer — it is neither counted nor expanded for.
  // LUM-775: nor does a row that left the queue when its PR merged / closed.
  const undispositioned = prs.flatMap(({ latest }) =>
    latest ? latest.findings.filter(isOpenFinding) : []
  )
  return {
    prs: prs.length,
    findings: undispositioned.length,
    allLow:
      undispositioned.length > 0 &&
      undispositioned.every(f => f.severity === 'LOW'),
    externalFailed: prs.filter(
      ({ latest }) => latest?.stages.external === 'FAILED'
    ).length,
    incomplete: prs.filter(
      ({ latest }) =>
        latest == null ||
        (!latest.complete &&
          !isOverSizeLimitOnly(latest) &&
          latest.coverage !== 'TURNED_OFF')
    ).length,
    overSizeLimit: prs.filter(
      ({ latest }) => latest != null && isOverSizeLimitOnly(latest)
    ).length,
    turnedOff: prs.filter(({ latest }) => latest?.coverage === 'TURNED_OFF')
      .length,
  }
}

/**
 * Whether a PR's row should default to expanded: an undispositioned finding
 * still needs a human decision, the scan did not complete (its stage notes,
 * not-configured hint or partial notice are the reason the summary cannot
 * claim a clean result — LUM-496 review F1), or the external scanner failed
 * with a concrete error worth reading. A manual toggle overrides this
 * afterward — this only decides the row's INITIAL state.
 */
export function shouldExpandRow(latest: SecurityScanView | null): boolean {
  if (!latest) return false
  if (latest.findings.some(isOpenFinding)) return true
  // LUM-892: a layer the customer turned off is no reason to open the row —
  // the summary line and the badge already say it.
  if (!latest.complete && latest.coverage !== 'TURNED_OFF') return true
  return latest.stages.external === 'FAILED' && latest.error != null
}
