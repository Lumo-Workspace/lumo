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
   */
  incomplete: number
}

export function summarizeSecurityScans(
  prs: Array<{ latest: SecurityScanView | null }>
): SecurityScanSummary {
  const undispositioned = prs.flatMap(({ latest }) =>
    latest ? latest.findings.filter(f => f.disposition == null) : []
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
    incomplete: prs.filter(({ latest }) => latest == null || !latest.complete)
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
  if (latest.findings.some(f => f.disposition == null)) return true
  if (!latest.complete) return true
  return latest.stages.external === 'FAILED' && latest.error != null
}
