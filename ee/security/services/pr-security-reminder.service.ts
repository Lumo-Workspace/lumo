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
import { isVerifierRejected } from '@/ee/security/security-scan/verifier'
import {
  prSecurityScanRepository,
  type FindingKind,
  type ScanStatus,
  type ScanWithFindings,
} from '@/ee/security/repositories/pr-security-scan.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import { taskRepository } from '@/lib/repositories/task.repository'
import {
  isBlockingFinding,
  latestScanPerPr,
  loadQueueExitContexts,
  loadSecurityPolicy,
  queueExitOf,
} from '@/ee/security/services/pr-security-scan-gate'
import type { QueueExitReason } from '@/ee/security/security-scan/queue-exit'
import { DEFAULT_SECURITY_POLICY } from '@/ee/security/security-scan/policy'
import {
  renderPreToolUseSecurityReminder,
  renderSessionStartSecuritySection,
  sortReminderFindings,
  type ReminderFinding,
  type UnconfirmedPr,
} from '@/ee/security/security-scan/agent-reminder'
import { stagesOf } from '@/ee/security/security-scan/stages'
import {
  parseHuntCoverage,
  type HuntCoverage,
} from '@/ee/security/security-scan/hunt/coverage'
import type { ScanStages } from '@/ee/security/security-scan/types'
import {
  huntBatchProgress,
  type HuntBatchProgress,
} from '@/ee/security/security-scan/hunt/batches'
import { scanSizeCaps } from '@/ee/security/security-scan/size-caps'
import { loadSecurityLayers } from './security-workspace-switches.service'
import { prFindingThreadRepository } from '@/ee/security/repositories/pr-finding-thread.repository'
import type {
  FindingDisposition,
  FindingProvenance,
  FindingSeverity,
} from '@/ee/security/repositories/pr-security-scan.repository'
import {
  prTooLargeOf,
  type HuntOverCapInput,
  type JudgeOverCapInput,
  type JudgePartialInput,
  type PrTooLargeInput,
} from '@/shared/src/security-scan'

export interface OpenSecurityFinding extends ReminderFinding {
  kind: FindingKind
  scanId: string
}

/**
 * LUM-735 — one linked PR's latest-scan summary, for `lumo task status`.
 * `externalFindings` counts findings with `provenance === 'EXTERNAL_TOOL'`
 * regardless of disposition (a raw external-tool hit count); `openFindings`
 * counts undispositioned findings on this scan (a subset of `findings` above,
 * scoped to this one PR).
 */
export interface TaskSecurityScanSummary {
  prNumber: number
  status: ScanStatus
  stages: ScanStages
  partial: boolean
  error: string | null
  externalFindings: number
  /** Undispositioned AND not `persisting` (LUM-738). */
  openFindings: number
  /** LUM-738 — DEPENDENCY rows (osv-scanner), regardless of disposition. */
  dependencyFindings: number
  /** LUM-738 — rows already on the default-branch baseline, any kind. */
  persistingFindings: number
  /**
   * LUM-762 — the L3 hunt's per-category read-out, parsed from the scan's
   * stored `huntAudit`. null when the row carries no usable audit (legacy
   * rows, or a hunt that failed before its first batch) — the CLI then prints
   * no coverage line rather than guessing.
   */
  hunt: HuntCoverage | null
  /**
   * LUM-832 — a batched hunt's covered source files of the total; null for an
   * un-batched hunt. Additive: an older CLI ignores it.
   */
  huntProgress: HuntBatchProgress | null
  /** LUM-832 — why it is not whole (drives owned vs over-cap wording). */
  partialCauses: string[]
  /** LUM-832 — the hunt did not run: over its file cap. null otherwise. */
  huntOverCap: HuntOverCapInput | null
  /** LUM-832 — the AI review did not run: over its size cap. null otherwise. */
  judgeOverCap: JudgeOverCapInput | null
  /** LUM-1144 — the AI review ran on part of an over-cap diff (skipped files named). null otherwise. */
  judgePartial: JudgePartialInput | null
  /**
   * LUM-1079 — the whole PR was too large to scan. null otherwise. Additive:
   * an older CLI ignores it.
   */
  prTooLarge: PrTooLargeInput | null
  /**
   * LUM-775 — undispositioned, non-persisting rows on this scan that have
   * left the queue because the PR merged or closed, by reason. Derived at
   * read time (never stored); `{}` on an open PR. Additive: an older CLI
   * ignores it.
   */
  queueExits: Partial<Record<QueueExitReason, number>>
  /**
   * LUM-901 — the workspace has scanning turned off, so this scan (for an
   * earlier commit) no longer vouches for the PR. Additive: an older CLI
   * ignores it.
   */
  scanningOff: boolean
}

export interface TaskSecurityOpenState {
  /** Undispositioned findings on each linked PR's LATEST scan, sorted. */
  findings: OpenSecurityFinding[]
  blockingCount: number
  /** Open PRs whose latest scan cannot vouch for them. */
  unconfirmedPrs: UnconfirmedPr[]
  /** The latest scan per PR (when one exists) — the reminder keys on these. */
  latestScans: Array<{ scanId: string; prNumber: number; headSha: string }>
  /** LUM-735 — one entry per PR with a latest scan (same set as
   *  `latestScans`, open or closed PRs alike). */
  scans: TaskSecurityScanSummary[]
  /** LUM-1328 — open PRs whose head has no imported agent review
   *  (`lumo security import`); empty while scanning is off. */
  agentReviewMissing: number[]
  /** LUM-1328 — Lumo's own AI review runs for this workspace. */
  lumoAiReviewOn: boolean
}

const EMPTY_STATE: TaskSecurityOpenState = {
  findings: [],
  blockingCount: 0,
  unconfirmedPrs: [],
  latestScans: [],
  scans: [],
  agentReviewMissing: [],
  lumoAiReviewOn: false,
}

/**
 * LUM-1328 — an agent review (`lumo security import`) was imported into the
 * PR's current head. A scan of an older head does not count; a PR whose head
 * Lumo has not recorded yet trusts its latest scan.
 */
export function hasAgentReviewOnHead(
  scan: Pick<ScanWithFindings, 'headSha' | 'agentReviewTools'> | undefined,
  prHeadSha: string | null
): boolean {
  if (!scan) return false
  if (prHeadSha !== null && scan.headSha !== prHeadSha) return false
  return (scan.agentReviewTools ?? []).length > 0
}

function unconfirmedReason(
  scan: ScanWithFindings | undefined
): UnconfirmedPr['reason'] | null {
  if (!scan) return 'NONE'
  // LUM-1079: a PR too large to scan is not a scan that broke.
  if (scan.status === 'FAILED')
    return prTooLargeOf(scan) ? 'TOO_LARGE' : 'FAILED'
  if (scan.status === 'PENDING') return 'PENDING'
  if (scan.status === 'RUNNING') return 'RUNNING'
  return null
}

/**
 * LUM-1234 — agent-behavior (REWARD_HACK) findings are advisory notes for
 * the humans reviewing the PR: the agent reminders leave them out (they are
 * neither security findings nor the agent's to rule on).
 */
function notAgentBehavior(f: { kind: string }): boolean {
  return f.kind !== 'REWARD_HACK'
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
    // LUM-740: the workspace policy decides which open findings block DONE.
    // LUM-775: the default-branch baselines decide which rows on merged PRs
    // have left the queue — read only when some PR is no longer open.
    const [policy, exitContexts] =
      scans.length > 0
        ? await Promise.all([
            loadSecurityPolicy(scans[0]!.workspaceId),
            loadQueueExitContexts(prs, scans[0]!.workspaceId),
          ])
        : [DEFAULT_SECURITY_POLICY, new Map()]
    // LUM-892: with scanning off, no scan vouches for an open PR's newer
    // commits — an earlier CLEAN must not keep standing as its answer. Old
    // findings still count (and still block DONE); only the vouching stops.
    const layers = await loadSecurityLayers(prs[0]!.workspaceId)
    const scanningOff = !layers.scan
    // LUM-1127: threads a human resolved on GitHub. Fail-open to "none": a
    // failed read shows those findings as open, never hides one.
    const resolvedOnGithub = await prFindingThreadRepository
      .findResolvedByUserFingerprints(prs.map(p => p.id))
      .catch(() => new Map<string, Set<string>>())
    const findings: OpenSecurityFinding[] = []
    const unconfirmedPrs: UnconfirmedPr[] = []
    const latestScans: TaskSecurityOpenState['latestScans'] = []
    const scanSummaries: TaskSecurityScanSummary[] = []
    const agentReviewMissing: number[] = []
    for (const pr of prs) {
      const scan = latest.get(pr.id)
      if (
        pr.state === 'open' &&
        !scanningOff &&
        !hasAgentReviewOnHead(scan, pr.headSha)
      ) {
        agentReviewMissing.push(pr.number)
      }
      // LUM-775: which undispositioned, non-persisting rows have left the
      // queue (merged / closed PR), and why — computed once per row here and
      // shared by the summary counters and the reminder list below.
      const exits = new Map<string, QueueExitReason>()
      // LUM-1127: a resolved conversation closes a NON-blocking finding; a
      // blocking one stays (and keeps blocking DONE) until dispositioned.
      const resolvedFps = resolvedOnGithub.get(pr.id)
      const closedOnGithub = (f: {
        fingerprint: string
        ruleId: string
        provenance: FindingProvenance
        severity: FindingSeverity
        disposition: FindingDisposition | null
        persisting?: boolean
      }) =>
        resolvedFps?.has(f.fingerprint) === true &&
        !isBlockingFinding(f, policy)
      if (scan) {
        for (const f of scan.findings) {
          if (f.disposition !== null || f.persisting) continue
          const exit = queueExitOf(f, pr, exitContexts, policy)
          if (exit) exits.set(f.id, exit)
        }
      }
      if (scan) {
        latestScans.push({
          scanId: scan.id,
          prNumber: pr.number,
          headSha: scan.headSha,
        })
        const queueExits: Partial<Record<QueueExitReason, number>> = {}
        for (const exit of exits.values())
          queueExits[exit] = (queueExits[exit] ?? 0) + 1
        scanSummaries.push({
          prNumber: pr.number,
          status: scan.status,
          stages: stagesOf(scan),
          partial: scan.partial,
          error: scan.error,
          externalFindings: scan.findings.filter(
            f => f.provenance === 'EXTERNAL_TOOL' && f.kind !== 'DEPENDENCY'
          ).length,
          openFindings: scan.findings.filter(
            f =>
              f.disposition === null &&
              !f.persisting &&
              !exits.has(f.id) &&
              !isVerifierRejected(f) &&
              !closedOnGithub(f)
          ).length,
          dependencyFindings: scan.findings.filter(f => f.kind === 'DEPENDENCY')
            .length,
          persistingFindings: scan.findings.filter(f => f.persisting).length,
          hunt: parseHuntCoverage(scan.huntAudit),
          huntProgress: huntBatchProgress(scan.huntJob, stagesOf(scan).hunt),
          partialCauses: scan.partialCauses ?? [],
          ...scanSizeCaps({
            stages: stagesOf(scan),
            partialCauses: scan.partialCauses ?? [],
            huntAudit: scan.huntAudit,
            judgeBudget: scan.judgeBudget,
            error: scan.error,
          }),
          queueExits,
          scanningOff,
        })
      }
      const reason = scanningOff ? 'SCANNING_OFF' : unconfirmedReason(scan)
      if (reason && pr.state === 'open') {
        unconfirmedPrs.push({ number: pr.number, reason })
      }
      if (!scan) continue
      for (const f of scan.findings) {
        if (f.disposition !== null) continue
        // LUM-738: already on the default branch — nothing this PR's agent
        // introduced or can fix here; the panel shows it muted, the reminder
        // and the next-actions list leave it out.
        if (f.persisting) continue
        // LUM-775: the PR merged or closed and this row has left the queue —
        // the panel shows it muted with the reason; the reminder, the
        // next-actions list and `openFindings` leave it out.
        if (exits.has(f.id)) continue
        // LUM-988: the agentic verifier rejected it after reading the code —
        // shown in the panel and `pr show`, never asked of the agent.
        if (isVerifierRejected(f)) continue
        // LUM-1127: a human resolved its thread on GitHub (non-blocking only).
        if (closedOnGithub(f)) continue
        findings.push({
          id: f.id,
          kind: f.kind,
          ruleId: f.ruleId,
          severity: f.severity,
          provenance: f.provenance,
          filePath: f.filePath,
          line: f.line,
          title: f.title,
          blocking: isBlockingFinding(f, policy),
          prNumber: pr.number,
          scanId: scan.id,
          secretDowngrade: f.secretDowngrade,
        })
      }
    }
    const sorted = sortReminderFindings(findings)
    return {
      findings: sorted,
      blockingCount: sorted.filter(f => f.blocking).length,
      unconfirmedPrs,
      latestScans,
      scans: scanSummaries,
      agentReviewMissing,
      lumoAiReviewOn: layers.aiReview,
    }
  },

  /** Session-start / attach section; `''` when there is nothing to show. */
  async buildSessionStartSection(
    taskId: string,
    identifier: string
  ): Promise<string> {
    const state = await this.loadOpenFindingsForTask(taskId)
    return renderSessionStartSecuritySection({
      findings: state.findings.filter(notAgentBehavior),
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
        findings: state.findings.filter(
          f => f.scanId === ls.scanId && notAgentBehavior(f)
        ),
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
