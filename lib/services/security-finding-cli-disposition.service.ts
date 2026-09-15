/**
 * LUM-750 — the CLI disposition path for PR security findings, isomorphic to
 * the LUM-769 boundary-crossing handshake:
 *
 *   1. READ    — `lumo finding disposition <id> --false-positive|--accept-risk`
 *                asks for a stage-1 receipt bound to (finding, task, ruling,
 *                caller, the finding's CURRENT state) and prints the envelope;
 *   2. ACK     — `--confirm-read --receipt <r1>` turns it into a stage-2 receipt
 *                carrying the read time;
 *   3. CONFIRM — `--confirm --receipt <r2>` writes; a stage-1 receipt is 409.
 *
 * The bulk ruling (`--all-suggested-fp`) binds the whole SET of suggested-
 * false-positive rows on the task's latest scans: a row joining, leaving or
 * changing voids the receipt, and the write touches exactly that set.
 *
 * Every CLI ruling appends a SECURITY_FINDING_DISPOSITIONED activity stamped
 * `channel: 'CLI'` with the handshake times (and the calling session), which is
 * what the LUM-750 self-disposition rollback keys on — a web-panel ruling
 * writes no activity and is never rolled back.
 *
 * What the handshake cannot prove is that a human personally ran each step —
 * which is why the CLI refuses to run inside an agent session and the
 * boundary detector records SELF_DISPOSITION when one gets through.
 */
import { activityRepository } from '@/lib/repositories/activity.repository'
import { memberRepository } from '@/lib/repositories/member.repository'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'
import {
  prSecurityScanRepository,
  type FindingDisposition,
  type FindingRow,
} from '@/lib/repositories/pr-security-scan.repository'
import {
  prSecurityScanService,
  type SecurityFindingView,
} from '@/lib/services/pr-security-scan.service'
import { latestScanPerPr } from '@/lib/services/pr-security-scan-gate'
import {
  acknowledgeReadReceipt,
  describeReceiptFailure,
  findingStateHash,
  findingsSetStateHash,
  issueReadReceipt,
  readReceiptSecret,
  verifyReadReceipt,
  type IssuedReceipt,
  type ReceiptFailure,
  type ReceiptSubject,
} from '@/lib/boundary-crossing/read-receipt'

/** Who is asking for / presenting a receipt (mirrors the crossing caller). */
export interface FindingReceiptCaller {
  sessionId: string | null
  memberId: string
}

export interface FindingCliAttribution {
  actorMemberId: string
  /** The caller's X-Lumo-Session-Id, recorded on the audit row. */
  sessionId: string | null
  handshake: { readAt: string; readAcknowledgedAt: string }
}

/** One finding as the CLI lists it: the panel view plus its PR number. */
export interface CliFindingView extends SecurityFindingView {
  prNumber: number
}

/** The slice of a suggested row the bulk envelope lists and the receipt binds. */
export interface SuggestedFindingRow {
  id: string
  ruleId: string
  severity: string
  provenance: string
  filePath: string
  line: number | null
  title: string
  suggestedReason: string | null
}

export const AGENT_ISSUED_REVERT_REASON = 'reverted: agent-issued'

const NOT_FOUND = () =>
  Object.assign(new Error('Security finding not found on this task'), {
    status: 404,
  })

function refusal(
  failure: ReceiptFailure,
  step: '--confirm-read' | '--confirm',
  subject: 'finding' | 'findings'
): Error {
  return Object.assign(
    new Error(describeReceiptFailure(failure, step, subject)),
    { status: 409 }
  )
}

function requireSecret(): string {
  const secret = readReceiptSecret()
  if (!secret) {
    throw Object.assign(
      new Error(
        'Read-receipt signing is not configured on this server (LUMO_RECEIPT_SECRET / CRON_SECRET) — CLI dispositions are unavailable; use the web panel'
      ),
      { status: 503 }
    )
  }
  return secret
}

async function findingOnTask(
  taskId: string,
  findingId: string
): Promise<FindingRow> {
  const finding = await prSecurityScanRepository.findFindingWithScope(findingId)
  if (!finding || finding.scan.pullRequest.taskId !== taskId) throw NOT_FOUND()
  return finding
}

/** The task's latest scan per linked PR — the rows the panel shows and counts. */
async function latestScanIds(taskId: string): Promise<string[]> {
  const prs = await pullRequestRepository.findManyForSecurityByTaskId(taskId)
  const scans = await prSecurityScanRepository.findLatestByPullRequestIds(
    prs.map(p => p.id)
  )
  return [...latestScanPerPr(scans).values()].map(s => s.id)
}

function toSuggestedRow(r: {
  id: string
  ruleId: string
  severity: string
  provenance: string
  filePath: string
  line: number | null
  title: string
  suggestedReason: string | null
}): SuggestedFindingRow {
  return {
    id: r.id,
    ruleId: r.ruleId,
    severity: r.severity,
    provenance: r.provenance,
    filePath: r.filePath,
    line: r.line,
    title: r.title,
    suggestedReason: r.suggestedReason,
  }
}

export const securityFindingCliDispositionService = {
  /** Every finding on the task's latest scans, flat, with its PR number. */
  async listForTask(taskId: string): Promise<{ findings: CliFindingView[] }> {
    const view = await prSecurityScanService.getForTask(taskId)
    const findings: CliFindingView[] = []
    for (const { pr, latest } of view.prs) {
      if (!latest) continue
      for (const f of latest.findings)
        findings.push({ ...f, prNumber: pr.number })
    }
    return { findings }
  },

  // ── single finding ────────────────────────────────────────────────────────

  async receiptSubject(
    taskId: string,
    findingId: string,
    target: FindingDisposition,
    caller: FindingReceiptCaller
  ): Promise<ReceiptSubject> {
    const f = await findingOnTask(taskId, findingId)
    return {
      kind: 'finding',
      crossingId: findingId,
      taskId,
      target,
      sessionId: caller.sessionId,
      memberId: caller.memberId,
      stateHash: findingStateHash({
        disposition: f.disposition,
        severity: f.severity,
        provenance: f.provenance,
        fingerprint: f.fingerprint,
        ruleId: f.ruleId,
        suggestedDisposition: f.suggestedDisposition,
      }),
    }
  },

  /** Stage 1: sign the finding as it stands now. Writes nothing. */
  async issueReadReceipt(
    taskId: string,
    findingId: string,
    target: FindingDisposition,
    caller: FindingReceiptCaller
  ): Promise<IssuedReceipt> {
    const subject = await this.receiptSubject(taskId, findingId, target, caller)
    return issueReadReceipt(requireSecret(), subject)
  },

  /** Stage 2: verify the stage-1 receipt against the finding NOW, issue stage 2. */
  async acknowledgeReadReceipt(
    taskId: string,
    findingId: string,
    target: FindingDisposition,
    receipt: string,
    caller: FindingReceiptCaller
  ): Promise<IssuedReceipt> {
    const subject = await this.receiptSubject(taskId, findingId, target, caller)
    const out = acknowledgeReadReceipt(requireSecret(), receipt, subject)
    if (out.ok) return out.issued
    throw refusal(out, '--confirm-read', 'finding')
  },

  /** Write-side check: a STAGE-2 receipt matching the finding NOW, or 409. */
  async verifyReadReceipt(
    taskId: string,
    findingId: string,
    target: FindingDisposition,
    receipt: string,
    caller: FindingReceiptCaller
  ): Promise<{ readAt: string; readAcknowledgedAt: string }> {
    const subject = await this.receiptSubject(taskId, findingId, target, caller)
    const verdict = verifyReadReceipt(
      requireSecret(),
      receipt,
      subject,
      new Date(),
      { requireStage: 'ACK' }
    )
    if (verdict.ok) {
      return {
        readAt: verdict.readAt,
        readAcknowledgedAt: verdict.readAcknowledgedAt ?? verdict.readAt,
      }
    }
    throw refusal(verdict, '--confirm', 'finding')
  },

  /**
   * The write: the same row update the web panel performs (via the scan
   * service), plus the append-only CLI audit row. Idempotent on an
   * already-matching ruling (no audit row). The route has already verified
   * the stage-2 receipt.
   */
  async disposition(
    taskId: string,
    findingId: string,
    target: FindingDisposition,
    note: string | null,
    attribution: FindingCliAttribution
  ): Promise<SecurityFindingView & { channel: 'CLI' }> {
    const before = await findingOnTask(taskId, findingId)
    const view = await prSecurityScanService.disposition(
      taskId,
      findingId,
      target,
      note,
      attribution.actorMemberId
    )
    if (before.disposition !== target) {
      const actor = await memberRepository.findActorByMemberId(
        attribution.actorMemberId
      )
      await activityRepository.create({
        taskId,
        actorId: actor?.id ?? null,
        type: 'SECURITY_FINDING_DISPOSITIONED',
        payload: dispositionPayload(before, target, note, attribution),
      })
    }
    return { ...view, channel: 'CLI' }
  },

  // ── bulk: every suggested false positive on the task ─────────────────────

  /** The rows the bulk ruling binds and would touch, in id order. */
  async suggestedRows(taskId: string): Promise<SuggestedFindingRow[]> {
    const rows =
      await prSecurityScanRepository.findSuggestedFalsePositivesByScanIds(
        await latestScanIds(taskId)
      )
    return rows.map(toSuggestedRow)
  },

  async bulkReceiptSubject(
    taskId: string,
    caller: FindingReceiptCaller
  ): Promise<{ subject: ReceiptSubject; rows: SuggestedFindingRow[] }> {
    const rows =
      await prSecurityScanRepository.findSuggestedFalsePositivesByScanIds(
        await latestScanIds(taskId)
      )
    return {
      rows: rows.map(toSuggestedRow),
      subject: {
        kind: 'findings',
        crossingId: `task:${taskId}`,
        taskId,
        target: 'FALSE_POSITIVE',
        sessionId: caller.sessionId,
        memberId: caller.memberId,
        stateHash: findingsSetStateHash(
          rows.map(r => ({
            id: r.id,
            disposition: r.disposition,
            severity: r.severity,
            provenance: r.provenance,
            fingerprint: r.fingerprint,
            ruleId: r.ruleId,
            suggestedDisposition: r.suggestedDisposition,
          }))
        ),
      },
    }
  },

  /** Stage 1 for the bulk ruling: the receipt AND the rows it binds (so the
   *  envelope lists exactly what the write will touch). 422 when the set is
   *  empty — there is nothing to rule on and no receipt to issue. */
  async issueBulkReadReceipt(
    taskId: string,
    caller: FindingReceiptCaller
  ): Promise<IssuedReceipt & { findings: SuggestedFindingRow[] }> {
    const { subject, rows } = await this.bulkReceiptSubject(taskId, caller)
    if (rows.length === 0) {
      throw Object.assign(
        new Error(
          'No undispositioned finding on this task carries a suggested false-positive disposition — nothing to rule on'
        ),
        { status: 422 }
      )
    }
    return { ...issueReadReceipt(requireSecret(), subject), findings: rows }
  },

  async acknowledgeBulkReadReceipt(
    taskId: string,
    receipt: string,
    caller: FindingReceiptCaller
  ): Promise<IssuedReceipt & { findings: SuggestedFindingRow[] }> {
    const { subject, rows } = await this.bulkReceiptSubject(taskId, caller)
    const out = acknowledgeReadReceipt(requireSecret(), receipt, subject)
    if (out.ok) return { ...out.issued, findings: rows }
    throw refusal(out, '--confirm-read', 'findings')
  },

  async verifyBulkReadReceipt(
    taskId: string,
    receipt: string,
    caller: FindingReceiptCaller
  ): Promise<{ readAt: string; readAcknowledgedAt: string }> {
    const { subject } = await this.bulkReceiptSubject(taskId, caller)
    const verdict = verifyReadReceipt(
      requireSecret(),
      receipt,
      subject,
      new Date(),
      { requireStage: 'ACK' }
    )
    if (verdict.ok) {
      return {
        readAt: verdict.readAt,
        readAcknowledgedAt: verdict.readAcknowledgedAt ?? verdict.readAt,
      }
    }
    throw refusal(verdict, '--confirm', 'findings')
  },

  /**
   * The bulk write: exactly the suggested-false-positive rows on the task's
   * latest scans (the repository WHERE is the same one the web bulk route
   * uses — nothing else is ever touched), each with its own CLI audit row so
   * the rollback can address them one by one.
   */
  async dispositionSuggested(
    taskId: string,
    attribution: FindingCliAttribution
  ): Promise<{ confirmed: number; findingIds: string[]; channel: 'CLI' }> {
    const scanIds = await latestScanIds(taskId)
    const rows =
      await prSecurityScanRepository.findSuggestedFalsePositivesByScanIds(
        scanIds
      )
    const confirmed = await prSecurityScanRepository.confirmSuggestedByScanIds(
      scanIds,
      {
        dispositionNote: 'Confirmed LLM suggestion (bulk, via CLI)',
        dispositionedById: attribution.actorMemberId,
        dispositionedAt: new Date(),
      }
    )
    const actor = await memberRepository.findActorByMemberId(
      attribution.actorMemberId
    )
    for (const r of rows) {
      await activityRepository.create({
        taskId,
        actorId: actor?.id ?? null,
        type: 'SECURITY_FINDING_DISPOSITIONED',
        payload: {
          ...dispositionPayload(
            r,
            'FALSE_POSITIVE',
            'Confirmed LLM suggestion (bulk, via CLI)',
            attribution
          ),
          bulk: true,
        },
      })
    }
    return { confirmed, findingIds: rows.map(r => r.id), channel: 'CLI' }
  },
}

function dispositionPayload(
  finding: Pick<
    FindingRow,
    'id' | 'ruleId' | 'filePath' | 'line' | 'disposition'
  >,
  target: FindingDisposition,
  note: string | null,
  attribution: FindingCliAttribution
): Record<string, unknown> {
  return {
    findingId: finding.id,
    ruleId: finding.ruleId,
    filePath: finding.filePath,
    line: finding.line,
    from: finding.disposition,
    to: target,
    disposition: target,
    note,
    channel: 'CLI',
    sessionId: attribution.sessionId,
    readAt: attribution.handshake.readAt,
    readAcknowledgedAt: attribution.handshake.readAcknowledgedAt,
    confirmedAt: new Date().toISOString(),
  }
}
