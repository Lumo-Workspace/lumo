import { logger } from '@/lib/logger'
import {
  prSecurityScanRepository,
  type RetentionCandidate,
} from '@/ee/security/repositories/pr-security-scan.repository'
import {
  DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
  isScanFinal,
  retentionCutoffs,
  scanEvidenceExpiryReason,
  type ScanEvidenceExpiryReason,
} from '@/ee/security/security-scan/evidence-retention'
import { isSuggestEnabled } from './security-suggest.config'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

/**
 * LUM-911 — scan evidence is kept only while it is in use (CodeRabbit keeps
 * no code past a review and its cache at most a week). The sweep scrubs the
 * code fields of every scan that is used up — see
 * `lib/security-scan/evidence-retention.ts` for the rule — and leaves the
 * rows, counts and dispositions. Scans from before LUM-911 are not tracked
 * (`retentionTracked = false`) and are left to the backlog task.
 */

/** Scans read per page; the scrub itself batches by `SCRUB_BATCH_SIZE`. */
export const RETENTION_SWEEP_PAGE = 200

/**
 * Zero retention in the sweep (the backstop behind the post-sync hook) waits
 * this long after a scan finished, so the PR review the scan's own writers
 * sync has had its turn to read the text first.
 */
export const ZERO_RETENTION_SWEEP_GRACE_MS = 15 * 60 * 1000

/**
 * LUM-914 — the sweep's whole call on one candidate: the pure rule plus the
 * zero-retention grace. Null = leave it; otherwise why it is scrubbed. The
 * pre-rule stock script (scripts/retention-stock.ts) asks the same question.
 */
export function scanRetentionDueReason(
  candidate: RetentionCandidate,
  retentionDays: number,
  allScansFinal: boolean,
  now: Date
): ScanEvidenceExpiryReason | null {
  if (retentionDays === 0) {
    const finishedAt = (candidate.finishedAt ?? candidate.startedAt).getTime()
    if (now.getTime() - finishedAt < ZERO_RETENTION_SWEEP_GRACE_MS) return null
  }
  return scanEvidenceExpiryReason({
    scan: candidate,
    pullRequest: candidate.pullRequest,
    allScansFinal,
    retentionDays,
    now,
  })
}

export async function sweepExpiredScanEvidence(
  now: Date = new Date()
): Promise<{ scans: number; findings: number; failed: number }> {
  const summary = { scans: 0, findings: 0, failed: 0 }
  const zeroRetention =
    await securityColumnsRepository.findZeroScanEvidenceRetentionIds()
  const { hardCap } = retentionCutoffs(now)
  let after: string | null = null
  for (;;) {
    const page = await prSecurityScanRepository.findRetentionCandidates({
      hardCapCutoff: hardCap,
      zeroRetentionWorkspaceIds: zeroRetention,
      after,
      take: RETENTION_SWEEP_PAGE,
    })
    if (page.length === 0) break
    after = page[page.length - 1]!.id

    const unfinished =
      await prSecurityScanRepository.findPullRequestsWithUnfinishedScans([
        ...new Set(page.map(c => c.pullRequestId)),
      ])
    const days = await securityColumnsRepository.findScanEvidenceRetention([
      ...new Set(page.map(c => c.workspaceId)),
    ])
    const due = page.filter(
      c =>
        scanRetentionDueReason(
          c,
          days.get(c.workspaceId) ?? DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
          !unfinished.has(c.pullRequestId),
          now
        ) !== null
    )
    try {
      const counts = await prSecurityScanRepository.scrubCodeForRetention(
        due.map(c => c.id)
      )
      summary.scans += counts.scans
      summary.findings += counts.findings
    } catch (error) {
      summary.failed += due.length
      logger.error(
        `[security-scan] retention: scrub of ${due.length} scan(s) failed; retried next run: ${String(error)}`
      )
    }
    if (page.length < RETENTION_SWEEP_PAGE) break
  }
  if (summary.scans > 0 || summary.failed > 0) {
    logger.info(
      `[security-scan] retention: scrubbed code from ${summary.scans} scan(s), ${summary.findings} finding(s); ${summary.failed} failed`
    )
  }
  return summary
}

/**
 * Zero retention, right after the scan's PR review sync: a final scan in a
 * workspace that keeps nothing is scrubbed now. While the falsifier pass has
 * not stamped a FINDINGS scan the review still holds comments back, so the
 * scan waits for the sync that follows the pass (or the sweep). Best effort:
 * never throws — the sync it follows has already landed.
 */
export async function scrubScanIfZeroRetention(
  scanId: string
): Promise<boolean> {
  try {
    const scan = await prSecurityScanRepository.findRetentionCandidate(scanId)
    if (!scan || !isScanFinal(scan)) return false
    const days = await securityColumnsRepository.findScanEvidenceRetention([
      scan.workspaceId,
    ])
    if (days.get(scan.workspaceId) !== 0) return false
    if (
      scan.status === 'FINDINGS' &&
      scan.suggestedAt === null &&
      isSuggestEnabled()
    )
      return false
    const counts = await prSecurityScanRepository.scrubCodeForRetention([
      scanId,
    ])
    return counts.scans > 0
  } catch (error) {
    logger.error(
      `[security-scan] scan ${scanId}: zero-retention scrub failed; the sweep retries: ${String(error)}`
    )
    return false
  }
}
