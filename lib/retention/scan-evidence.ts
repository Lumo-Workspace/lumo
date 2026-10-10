/**
 * LUM-911 / LUM-1060 — the PR security scan's evidence-retention tiers and the
 * sweep cutoff, moved into the core (RFC LUM-1058 §2.1 scan-retention: the
 * legal page figures, the workspace settings and the retention-stock service
 * only need these). Pure (no Prisma, no I/O). The expiry rules and the sweep
 * stay with the scan in `lib/security-scan/evidence-retention`, which
 * re-exports everything here.
 */

/** OWNER-selectable retention tiers, in days. 0 = zero retention. */
export const SCAN_EVIDENCE_RETENTION_DAYS = [0, 7, 14, 30] as const

export type ScanEvidenceRetentionDays =
  (typeof SCAN_EVIDENCE_RETENTION_DAYS)[number]

export const DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS: ScanEvidenceRetentionDays = 7

/**
 * A scan on a PR that never closes still gives its code up this long after
 * it finished. Not below the longest tier: an OWNER's choice is never cut
 * short by the cap.
 */
export const SCAN_EVIDENCE_HARD_CAP_DAYS = 30

export function isScanEvidenceRetentionDays(
  value: unknown
): value is ScanEvidenceRetentionDays {
  return (SCAN_EVIDENCE_RETENTION_DAYS as readonly unknown[]).includes(value)
}

const DAY_MS = 24 * 60 * 60 * 1000

/** The cutoffs a sweep query can narrow candidates with before the exact check. */
export function retentionCutoffs(now: Date) {
  return {
    // Anything finished before this is past the hard cap whatever the tier.
    hardCap: new Date(now.getTime() - SCAN_EVIDENCE_HARD_CAP_DAYS * DAY_MS),
  }
}
