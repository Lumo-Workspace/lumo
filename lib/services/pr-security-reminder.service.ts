/**
 * LUM-737 — agent-facing read-out of undispositioned PR security findings.
 *
 * Three surfaces share one read model: the session-start section, the
 * one-shot PreToolUse reminder and `lumo task status` nextActions. Read-only
 * (the only write is the `agentNotifiedAt` stamp) and LLM-free, so
 * task-context / task-verification / the hook routes can import it
 * statically — unlike `pr-security-scan.service.ts`, which reaches the LLM
 * gateway and must stay behind a dynamic import.
 *
 * Honesty rules inherited from LUM-732: a scan that FAILED / never ran is
 * "could not confirm", never "clean"; disposition stays human-only.
 */
import {
  prSecurityScanRepository,
  type FindingKind,
  type ScanWithFindings,
} from '@/lib/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  isBlockingFinding,
  latestScanPerPr,
} from '@/lib/services/pr-security-scan-gate'
import {
  renderPreToolUseSecurityReminder,
  renderSessionStartSecuritySection,
  sortReminderFindings,
  type ReminderFinding,
  type UnconfirmedPr,
} from '@/lib/security-scan/agent-reminder'

export interface OpenSecurityFinding extends ReminderFinding {
  kind: FindingKind
  scanId: string
}

export interface TaskSecurityOpenState {
  /** Undispositioned findings on each linked PR's LATEST scan, sorted. */
  findings: OpenSecurityFinding[]
  blockingCount: number
  /** Open PRs whose latest scan cannot vouch for them. */
  unconfirmedPrs: UnconfirmedPr[]
  /** The latest scan per PR (when one exists) — the reminder keys on these. */
  latestScans: Array<{ scanId: string; prNumber: number; headSha: string }>
}

const EMPTY_STATE: TaskSecurityOpenState = {
  findings: [],
  blockingCount: 0,
  unconfirmedPrs: [],
  latestScans: [],
}

function unconfirmedReason(
  scan: ScanWithFindings | undefined
): UnconfirmedPr['reason'] | null {
  if (!scan) return 'NONE'
  if (scan.status === 'FAILED') return 'FAILED'
  if (scan.status === 'PENDING') return 'PENDING'
  if (scan.status === 'RUNNING') return 'RUNNING'
  return null
}

export const prSecurityReminderService = {
  async loadOpenFindingsForTask(
    taskId: string
  ): Promise<TaskSecurityOpenState> {
    const prs = await pullRequestRepository.findManyForSecurityByTaskId(taskId)
    if (prs.length === 0) return { ...EMPTY_STATE }
    const scans = await prSecurityScanRepository.findLatestByPullRequestIds(
      prs.map(p => p.id)
    )
    const latest = latestScanPerPr(scans)
    const findings: OpenSecurityFinding[] = []
    const unconfirmedPrs: UnconfirmedPr[] = []
    const latestScans: TaskSecurityOpenState['latestScans'] = []
    for (const pr of prs) {
      const scan = latest.get(pr.id)
      if (scan) {
        latestScans.push({
          scanId: scan.id,
          prNumber: pr.number,
          headSha: scan.headSha,
        })
      }
      const reason = unconfirmedReason(scan)
      if (reason && pr.state === 'open') {
        unconfirmedPrs.push({ number: pr.number, reason })
      }
      if (!scan) continue
      for (const f of scan.findings) {
        if (f.disposition !== null) continue
        findings.push({
          id: f.id,
          kind: f.kind,
          ruleId: f.ruleId,
          severity: f.severity,
          provenance: f.provenance,
          filePath: f.filePath,
          line: f.line,
          title: f.title,
          blocking: isBlockingFinding(f),
          prNumber: pr.number,
          scanId: scan.id,
        })
      }
    }
    const sorted = sortReminderFindings(findings)
    return {
      findings: sorted,
      blockingCount: sorted.filter(f => f.blocking).length,
      unconfirmedPrs,
      latestScans,
    }
  },

  /** Session-start / attach section; `''` when there is nothing to show. */
  async buildSessionStartSection(
    taskId: string,
    identifier: string
  ): Promise<string> {
    const state = await this.loadOpenFindingsForTask(taskId)
    return renderSessionStartSecuritySection({
      findings: state.findings,
      unconfirmedPrs: state.unconfirmedPrs,
      identifier,
    })
  },

  /**
   * One-shot PreToolUse reminder (LUM-737, same shape as LUM-542). Reads only
   * FINDINGS scans not yet stamped — the common case returns nothing after one
   * indexed query. When something is un-notified it re-reads the latest scans,
   * stamps EVERY un-notified row (including ones a newer scan superseded, or
   * whose findings were all dispositioned meanwhile — otherwise they would sit
   * in the query result forever) and renders only the rows that are still the
   * PR's latest scan with ≥1 open finding.
   */
  async buildAgentReminder(taskId: string): Promise<string | null> {
    const unnotified =
      await prSecurityScanRepository.findUnnotifiedFindingScansByTask(taskId)
    if (unnotified.length === 0) return null
    const state = await this.loadOpenFindingsForTask(taskId)
    // LUM-737 (whole-branch review): read the header and render BEFORE
    // stamping `agentNotifiedAt` — spec §7 says an un-stamped failure retries
    // on the next hook, so a throw here (e.g. the header read rejects) must
    // leave every row un-notified rather than losing the reminder forever.
    const header = await taskRepository.findHeaderById(taskId)
    const identifier = header
      ? `${header.team.identifier}-${header.number}`
      : taskId
    const fresh = new Set(unnotified.map(s => s.id))
    const scans = state.latestScans
      .filter(ls => fresh.has(ls.scanId))
      .map(ls => ({
        prNumber: ls.prNumber,
        headSha: ls.headSha,
        findings: state.findings.filter(f => f.scanId === ls.scanId),
      }))
      .filter(s => s.findings.length > 0)
    const rendered =
      scans.length === 0
        ? null
        : renderPreToolUseSecurityReminder({ scans, identifier })
    // Stamp EVERY un-notified id — including ones a newer scan superseded, or
    // whose findings were all dispositioned meanwhile — so they never sit in
    // the un-notified query result forever, even when nothing renders.
    await prSecurityScanRepository.markAgentNotified(
      unnotified.map(s => s.id),
      new Date()
    )
    return rendered
  },
}
