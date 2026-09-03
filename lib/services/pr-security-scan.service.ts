/**
 * LUM-732 — PR security scan orchestration.
 *
 * run():  resolve PR → current head sha → dedup on (pr, sha) → fetch diff →
 *         deterministic secret scan → LLM judge (dynamic import, fail-soft) →
 *         inherit dispositions by fingerprint → persist → finalize.
 * Runs inside the /api/internal/pr-security-scan worker (300s), never inline.
 *
 * Secrets never reach a row: scanSecrets redacts before returning, and
 * credential-shaped LLM evidence is masked with maskQuotedValues.
 */
import { logger } from '@/lib/logger'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  prSecurityScanRepository,
  type NewFindingInput,
  type ScanTrigger,
  type FindingDisposition,
  type FindingKind,
  type FindingProvenance,
  type FindingSeverity,
  type FindingRow,
  type ScanStatus,
  type JudgeStatus,
  type ScanWithFindings,
} from '@/lib/repositories/pr-security-scan.repository'
import { fetchPrDiff, fetchPrHeadSha } from '@/lib/integrations/github/contents'
import {
  addedLinesWithNumbers,
  scanSecrets,
  truncateSecurityDiff,
  maskQuotedValues,
  redactKnownSecrets,
  vulnerabilityFingerprint,
} from '@/lib/security-scan'
import { isBlockingFinding, latestScanPerPr } from './pr-security-scan-gate'

export const DETECTOR_VERSION = 'secrets@1;judge@1'

// ── View types (shared by route, hook and components) ────────────────────────

export interface SecurityFindingView {
  id: string
  kind: FindingKind
  ruleId: string
  severity: FindingSeverity
  provenance: FindingProvenance
  filePath: string
  line: number | null
  title: string
  detail: string
  evidence: string
  fingerprint: string
  disposition: FindingDisposition | null
  dispositionNote: string | null
  inherited: boolean
  blocking: boolean
}

export interface SecurityScanView {
  id: string
  status: ScanStatus
  headSha: string
  trigger: ScanTrigger
  judgeStatus: JudgeStatus | null
  truncated: boolean
  error: string | null
  startedAt: string
  finishedAt: string | null
  findings: SecurityFindingView[]
}

export interface TaskSecurityScans {
  prs: {
    pr: {
      id: string
      number: number
      title: string
      url: string
      state: string
    }
    latest: SecurityScanView | null
  }[]
  blocking: { count: number }
}

export type RunScanResult =
  | { skipped: true; reason: 'pr_not_found' }
  | { deduped: true; scanId: string }
  | {
      deduped: false
      scanId: string
      status: 'CLEAN' | 'FINDINGS' | 'FAILED'
      findings: number
    }

// ── Helpers ──────────────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0,
}
const PROVENANCE_RANK: Record<FindingProvenance, number> = {
  DETERMINISTIC: 0,
  EXTERNAL_TOOL: 1,
  LLM_JUDGE: 2,
}

function sortFindings<
  T extends { severity: FindingSeverity; provenance: FindingProvenance },
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      PROVENANCE_RANK[a.provenance] - PROVENANCE_RANK[b.provenance]
  )
}

function toFindingView(f: FindingRow): SecurityFindingView {
  return {
    id: f.id,
    kind: f.kind,
    ruleId: f.ruleId,
    severity: f.severity,
    provenance: f.provenance,
    filePath: f.filePath,
    line: f.line,
    title: f.title,
    detail: f.detail,
    evidence: f.evidence,
    fingerprint: f.fingerprint,
    disposition: f.disposition,
    dispositionNote: f.dispositionNote,
    inherited: f.inheritedFromFindingId !== null,
    blocking: isBlockingFinding(f),
  }
}

function toScanView(s: ScanWithFindings): SecurityScanView {
  return {
    id: s.id,
    status: s.status,
    headSha: s.headSha,
    trigger: s.trigger,
    judgeStatus: s.judgeStatus,
    truncated: s.truncated,
    error: s.error,
    startedAt: s.startedAt.toISOString(),
    finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
    findings: sortFindings(s.findings).map(toFindingView),
  }
}

/** Copy a prior human disposition onto a new finding with the same fingerprint. */
function inheritDispositions(
  fresh: NewFindingInput[],
  prior: Awaited<
    ReturnType<typeof prSecurityScanRepository.findDispositionedByPullRequest>
  >
): NewFindingInput[] {
  const byFp = new Map<string, (typeof prior)[number]>()
  for (const p of prior)
    if (!byFp.has(p.fingerprint)) byFp.set(p.fingerprint, p)
  return fresh.map(f => {
    const p = byFp.get(f.fingerprint)
    if (!p) return f
    return {
      ...f,
      disposition: p.disposition,
      dispositionNote: p.dispositionNote,
      dispositionedById: p.dispositionedById,
      dispositionedAt: p.dispositionedAt,
      inheritedFromFindingId: p.id,
    }
  })
}

// ── Service ──────────────────────────────────────────────────────────────────

export const prSecurityScanService = {
  async run(input: {
    pullRequestId: string
    trigger: ScanTrigger
  }): Promise<RunScanResult> {
    const pr = await pullRequestRepository.findById(input.pullRequestId)
    if (!pr) return { skipped: true, reason: 'pr_not_found' }

    const headSha = await fetchPrHeadSha({
      workspaceId: pr.workspaceId,
      fullName: pr.repo,
      prNumber: pr.number,
    })

    const existing = await prSecurityScanRepository.findByPrAndSha(
      pr.id,
      headSha
    )
    let scanId: string
    if (existing) {
      if (existing.status !== 'FAILED')
        return { deduped: true, scanId: existing.id }
      await prSecurityScanRepository.restart(existing.id)
      scanId = existing.id
    } else {
      const created = await prSecurityScanRepository.create({
        pullRequestId: pr.id,
        taskId: pr.taskId,
        workspaceId: pr.workspaceId,
        headSha,
        trigger: input.trigger,
        detectorVersion: DETECTOR_VERSION,
      })
      scanId = created.id
    }

    try {
      const diff = await fetchPrDiff({
        workspaceId: pr.workspaceId,
        fullName: pr.repo,
        prNumber: pr.number,
      })
      const files = addedLinesWithNumbers(diff)

      const secretRows: NewFindingInput[] = scanSecrets(files).map(f => ({
        scanId,
        kind: f.kind,
        ruleId: f.ruleId,
        severity: f.severity,
        provenance: 'DETERMINISTIC',
        filePath: f.filePath,
        line: f.line,
        title: f.title,
        detail: f.detail,
        evidence: f.evidence,
        fingerprint: f.fingerprint,
        disposition: null,
      }))

      let judgeStatus: JudgeStatus = 'SKIPPED'
      let truncated = false
      const judgeRows: NewFindingInput[] = []
      if (files.length > 0) {
        const capped = truncateSecurityDiff(diff)
        truncated = capped.truncated
        try {
          // Dynamic import keeps @ai-sdk/gateway out of the static graph.
          const { judgeSecurity } =
            await import('@/lib/llm/security-judge-client')
          const { findings } = await judgeSecurity({ diff: capped.text })
          judgeStatus = 'RAN'
          for (const j of findings) {
            const isCredential = j.kind === 'hardcoded_credential'
            const ruleId = isCredential
              ? 'secret:llm-hardcoded-credential'
              : `vuln:${j.kind}`
            judgeRows.push({
              scanId,
              kind: isCredential ? 'SECRET' : 'VULNERABILITY',
              ruleId,
              severity: j.severity,
              provenance: 'LLM_JUDGE',
              filePath: j.filePath,
              line: j.line,
              title: j.title,
              detail: j.detail,
              // Two-layer redaction: known fingerprints first, then any long quoted
              // value when the judge says it is a credential.
              evidence: redactKnownSecrets(
                isCredential ? maskQuotedValues(j.evidence) : j.evidence
              ),
              fingerprint: vulnerabilityFingerprint(
                ruleId,
                j.filePath,
                j.title
              ),
              disposition: null,
            })
          }
        } catch (error) {
          // FAIL-SOFT for the judge only: the deterministic result still lands,
          // and UNAVAILABLE is stamped so the panel never reads as a full pass.
          judgeStatus = 'UNAVAILABLE'
          logger.warn(
            `[pr-security-scan] judge unavailable pr=${pr.id} sha=${headSha}:`,
            error instanceof Error ? error.message : error
          )
        }
      }

      const prior =
        await prSecurityScanRepository.findDispositionedByPullRequest(pr.id)
      const rows = inheritDispositions([...secretRows, ...judgeRows], prior)
      await prSecurityScanRepository.createFindings(rows)

      const status: 'CLEAN' | 'FINDINGS' =
        rows.length > 0 ? 'FINDINGS' : 'CLEAN'
      await prSecurityScanRepository.finalize(scanId, {
        status,
        judgeStatus,
        truncated,
      })
      return { deduped: false, scanId, status, findings: rows.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error(
        `[pr-security-scan] scan failed pr=${pr.id} sha=${headSha}: ${message}`
      )
      await prSecurityScanRepository.finalize(scanId, {
        status: 'FAILED',
        judgeStatus: null,
        truncated: false,
        error: message.slice(0, 500),
      })
      return { deduped: false, scanId, status: 'FAILED', findings: 0 }
    }
  },

  async getForTask(taskId: string): Promise<TaskSecurityScans> {
    const prs = await pullRequestRepository.findManyForSecurityByTaskId(taskId)
    const scans = await prSecurityScanRepository.findLatestByPullRequestIds(
      prs.map(p => p.id)
    )
    const latest = latestScanPerPr(scans)
    let count = 0
    const out = prs.map(pr => {
      const scan = latest.get(pr.id)
      const view = scan ? toScanView(scan) : null
      if (view) count += view.findings.filter(f => f.blocking).length
      return { pr, latest: view }
    })
    return { prs: out, blocking: { count } }
  },

  async disposition(
    taskId: string,
    findingId: string,
    disposition: FindingDisposition,
    note: string | null,
    actorMemberId: string
  ): Promise<SecurityFindingView> {
    const finding =
      await prSecurityScanRepository.findFindingWithScope(findingId)
    if (!finding || finding.scan.pullRequest.taskId !== taskId) {
      throw Object.assign(
        new Error('Security finding not found on this task'),
        { status: 404 }
      )
    }
    const updated = await prSecurityScanRepository.updateDisposition(
      findingId,
      {
        disposition,
        dispositionNote: note,
        dispositionedById: actorMemberId,
        dispositionedAt: new Date(),
      }
    )
    return toFindingView(updated)
  },
}
