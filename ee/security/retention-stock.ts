/**
 * LUM-914 / LUM-1061 — the security plugin's retention-stock category,
 * `scan-evidence`: scans from before LUM-911 (`retentionTracked = false`)
 * still holding code, judged by the LUM-911 rule (`scanRetentionDueReason`)
 * under the workspace's current tier. Moved out of
 * lib/services/retention-stock.service.ts unchanged; the core runs it through
 * the `retention` extension point.
 */
import type {
  RetentionStockClassified,
  RetentionStockDriver,
} from '@/lib/plugins/types'
import {
  prSecurityScanRepository,
  type RetentionCandidate,
} from '@/ee/security/repositories/pr-security-scan.repository'
import {
  DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
  retentionCutoffs,
} from '@/lib/retention/scan-evidence'
import { scanRetentionDueReason } from '@/ee/security/services/scan-evidence-retention.service'
import { securityColumnsRepository } from '@/ee/security/repositories/security-columns.repository'

/** Rows read per stock query. */
const PAGE = 200

function bump(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by
}

export function scanEvidenceStockDriver(): RetentionStockDriver<RetentionCandidate> {
  return {
    async *pages(now) {
      const zeroRetention =
        await securityColumnsRepository.findZeroScanEvidenceRetentionIds()
      const { hardCap } = retentionCutoffs(now)
      let after: string | null = null
      for (;;) {
        const page = await prSecurityScanRepository.findRetentionCandidates({
          hardCapCutoff: hardCap,
          zeroRetentionWorkspaceIds: zeroRetention,
          after,
          take: PAGE,
          retentionTracked: false,
        })
        if (page.length === 0) return
        after = page[page.length - 1]!.id
        const unfinished =
          await prSecurityScanRepository.findPullRequestsWithUnfinishedScans([
            ...new Set(page.map(c => c.pullRequestId)),
          ])
        const days = await securityColumnsRepository.findScanEvidenceRetention([
          ...new Set(page.map(c => c.workspaceId)),
        ])
        yield page.map((c): RetentionStockClassified<RetentionCandidate> => {
          const reason = scanRetentionDueReason(
            c,
            days.get(c.workspaceId) ?? DEFAULT_SCAN_EVIDENCE_RETENTION_DAYS,
            !unfinished.has(c.pullRequestId),
            now
          )
          return reason
            ? {
                due: true,
                row: c,
                reason,
                workspaceId: c.workspaceId,
                at: c.finishedAt ?? c.startedAt,
              }
            : { due: false, row: c, reason: 'not_due_yet' }
        })
        if (page.length < PAGE) return
      }
    },
    async process(rows) {
      const counts = await prSecurityScanRepository.scrubCodeForRetention(
        rows.map(r => r.row.id),
        { retentionTracked: false }
      )
      return { processed: counts.scans, findings: counts.findings }
    },
    async finishPlan(plan, dueRows) {
      let findings = 0
      for (let i = 0; i < dueRows.length; i += PAGE) {
        const counts = await prSecurityScanRepository.countFindingsByScan(
          dueRows.slice(i, i + PAGE).map(r => r.id)
        )
        for (const n of counts.values()) findings += n
      }
      plan.findings = findings
      // The candidate query only reads scans that could be due (final and
      // past the cap, on an ended PR, or zero retention); the rest of the
      // untracked stock is held — open PRs inside the cap, unfinished scans.
      const total = await prSecurityScanRepository.countUntrackedUnscrubbed()
      const read = plan.due + (plan.held.not_due_yet ?? 0)
      if (total > read) bump(plan.held, 'not_final_or_open_pr', total - read)
    },
  }
}
