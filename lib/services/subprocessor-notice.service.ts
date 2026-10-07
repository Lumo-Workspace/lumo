import { buildSubprocessorChangeEmail } from '@/lib/integrations/email'
import type { SubprocessorChangeEmailResult } from '@/lib/integrations/email'
import {
  daysUntilEffective,
  isUrgent,
  noticeRefusal,
} from '@/lib/legal/subprocessor-change-log'
import {
  NOTICE_PERIOD_DAYS,
  PRIVACY_CONTACT_EMAIL,
  PUBLIC_SECURITY_URL,
  SUBPROCESSOR_CHANGES,
  type SubprocessorChange,
} from '@/lib/legal/subprocessor-changes'
import { subprocessorNoticeRepository } from '@/lib/repositories/subprocessor-notice.repository'
import {
  recordAuditEvent,
  SYSTEM_AUDIT_CONTEXT,
} from '@/lib/services/audit.service'

/**
 * LUM-919: email a subprocessor change (DPA 7.2) to the OWNERs of every
 * workspace. Never runs on its own — only `scripts/subprocessor-notice/send.ts`,
 * started by an operator, calls it (dry run by default).
 *
 * Recipients: every active OWNER (deactivated members excluded, LUM-906) of
 * every workspace, one email per owner per workspace. A workspace scheduled
 * for deletion is still notified — the notice is owed until its data is gone,
 * and a cancelled deletion would otherwise leave it un-notified. A purged
 * workspace has no rows left, so it is never a recipient.
 *
 * Idempotent: each delivered (change, workspace, owner) is recorded in
 * SubprocessorNoticeDelivery after the SMTP server accepts it, and a rerun
 * skips it; the email idempotency key (app-level ledger, LUM-1041) covers a
 * crash between the send and the record.
 * Each workspace that got the notice also gets a SYSTEM audit event.
 */

export interface NoticeMessage {
  to: string
  subject: string
  html: string
  text: string
  idempotencyKey: string
}

export interface NoticeDeps {
  /** Sends one email; throws when the provider rejects it. */
  sendEmail(message: NoticeMessage): Promise<{ messageId: string | null }>
  /** Clerk id → primary email (null / missing = no address on record). */
  lookupEmails(
    clerkIds: readonly string[]
  ): Promise<ReadonlyMap<string, string | null>>
  now: Date
  /** Defaults to SUBPROCESSOR_CHANGES. */
  changes?: readonly SubprocessorChange[]
}

export interface NoticeWorkspacePlan {
  workspaceId: string
  workspaceName: string
  pendingDeletion: boolean
  owners: number
  alreadyNotified: number
  toNotify: number
  /** Owners still to notify with no email address on record. */
  missingEmail: number
}

export interface NoticePlan {
  change: SubprocessorChange
  /** Why the change may not be sent now; null = sendable. */
  refusal: string | null
  workspaces: NoticeWorkspacePlan[]
  totals: {
    workspaces: number
    owners: number
    alreadyNotified: number
    toNotify: number
    missingEmail: number
  }
  /** The email as the first workspace still to notify would get it. */
  preview: SubprocessorChangeEmailResult
}

export interface NoticeFailure {
  workspaceId: string
  clerkId: string
  reason: string
}

export interface NoticeSendResult {
  changeId: string
  sent: number
  alreadyNotified: number
  failed: NoticeFailure[]
  /**
   * Sent, but the delivery record failed to write: a rerun would email these
   * owners again (Resend's idempotency key only dedupes for 24 hours).
   */
  unrecorded: NoticeFailure[]
  /** Workspaces that got at least one email in this run. */
  workspacesNotified: number
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function httpError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status })
}

/** The change with this id, or a 404-style error. */
export function findSubprocessorChange(
  changeId: string,
  changes: readonly SubprocessorChange[] = SUBPROCESSOR_CHANGES
): SubprocessorChange {
  const change = changes.find(c => c.id === changeId)
  if (!change)
    throw httpError(`No subprocessor change with id ${changeId}`, 404)
  return change
}

/**
 * The notice email for one workspace, sent at `now`. The urgent wording ("less
 * than 30 days' notice") appears only when it is true at send time.
 */
export function renderSubprocessorNotice(
  change: SubprocessorChange,
  workspaceName: string,
  now: Date
): SubprocessorChangeEmailResult {
  const shortNotice =
    isUrgent(change) && daysUntilEffective(change, now) < NOTICE_PERIOD_DAYS
  return buildSubprocessorChangeEmail({
    workspaceName,
    kind: change.kind,
    summary: change.summary,
    effectiveAt: change.effectiveAt,
    urgentReason: shortNotice ? change.urgent?.reason : undefined,
    noticePeriodDays: NOTICE_PERIOD_DAYS,
    securityUrl: `${PUBLIC_SECURITY_URL}#subprocessor-changes`,
    privacyEmail: PRIVACY_CONTACT_EMAIL,
  })
}

const deliveryKey = (workspaceId: string, clerkId: string) =>
  `${workspaceId}:${clerkId}`

/** Dry run: who would get the notice now, and what it says. Sends nothing. */
export async function planSubprocessorNotice(
  changeId: string,
  deps: NoticeDeps
): Promise<NoticePlan> {
  const change = findSubprocessorChange(changeId, deps.changes)
  const [workspaces, delivered] = await Promise.all([
    subprocessorNoticeRepository.listWorkspacesWithOwners(),
    subprocessorNoticeRepository.listDelivered(change.id),
  ])
  const pendingIds = workspaces.flatMap(w =>
    w.owners
      .filter(o => !delivered.has(deliveryKey(w.id, o.clerkId)))
      .map(o => o.clerkId)
  )
  const emails = await deps.lookupEmails([...new Set(pendingIds)])

  const rows = workspaces.map(w => {
    const todo = w.owners.filter(
      o => !delivered.has(deliveryKey(w.id, o.clerkId))
    )
    return {
      workspaceId: w.id,
      workspaceName: w.name,
      pendingDeletion: w.deletionRequestedAt !== null,
      owners: w.owners.length,
      alreadyNotified: w.owners.length - todo.length,
      toNotify: todo.length,
      missingEmail: todo.filter(o => !emails.get(o.clerkId)).length,
    }
  })
  const sum = (k: 'owners' | 'alreadyNotified' | 'toNotify' | 'missingEmail') =>
    rows.reduce((n, r) => n + r[k], 0)
  const first = rows.find(r => r.toNotify > 0)
  return {
    change,
    refusal: noticeRefusal(change, deps.now),
    workspaces: rows,
    totals: {
      workspaces: rows.length,
      owners: sum('owners'),
      alreadyNotified: sum('alreadyNotified'),
      toNotify: sum('toNotify'),
      missingEmail: sum('missingEmail'),
    },
    preview: renderSubprocessorNotice(
      change,
      first?.workspaceName ?? 'Example workspace',
      deps.now
    ),
  }
}

/**
 * Send the notice to every owner not yet notified. Refuses (409) a change
 * that `noticeRefusal` rejects. A failed send is reported and left
 * unrecorded, so the next run retries it.
 */
export async function sendSubprocessorNotice(
  changeId: string,
  deps: NoticeDeps
): Promise<NoticeSendResult> {
  const change = findSubprocessorChange(changeId, deps.changes)
  const refusal = noticeRefusal(change, deps.now)
  if (refusal) throw httpError(refusal, 409)

  const [workspaces, delivered] = await Promise.all([
    subprocessorNoticeRepository.listWorkspacesWithOwners(),
    subprocessorNoticeRepository.listDelivered(change.id),
  ])
  const todoIds = workspaces.flatMap(w =>
    w.owners
      .filter(o => !delivered.has(deliveryKey(w.id, o.clerkId)))
      .map(o => o.clerkId)
  )
  const emails = await deps.lookupEmails([...new Set(todoIds)])

  const result: NoticeSendResult = {
    changeId: change.id,
    sent: 0,
    alreadyNotified: 0,
    failed: [],
    unrecorded: [],
    workspacesNotified: 0,
  }
  for (const w of workspaces) {
    const email = renderSubprocessorNotice(change, w.name, deps.now)
    let sentHere = 0
    let failedHere = 0
    for (const { clerkId } of w.owners) {
      if (delivered.has(deliveryKey(w.id, clerkId))) {
        result.alreadyNotified++
        continue
      }
      const to = emails.get(clerkId)
      if (!to) {
        result.failed.push({ workspaceId: w.id, clerkId, reason: 'no email' })
        failedHere++
        continue
      }
      let messageId: string | null
      try {
        const sentMessage = await deps.sendEmail({
          to,
          ...email,
          idempotencyKey: `subprocessor-change/${change.id}/${w.id}/${clerkId}`,
        })
        messageId = sentMessage.messageId
      } catch (error) {
        result.failed.push({
          workspaceId: w.id,
          clerkId,
          reason: reasonOf(error),
        })
        failedHere++
        continue
      }
      // Sent: count it whatever happens to the record below.
      result.sent++
      sentHere++
      try {
        await subprocessorNoticeRepository.recordDelivery({
          changeId: change.id,
          workspaceId: w.id,
          clerkId,
          messageId,
        })
      } catch (error) {
        result.unrecorded.push({
          workspaceId: w.id,
          clerkId,
          reason: reasonOf(error),
        })
      }
    }
    if (sentHere > 0) {
      result.workspacesNotified++
      await recordAuditEvent({
        workspaceId: w.id,
        action: 'subprocessor_change.notified',
        target: { type: 'subprocessor_change', id: change.id },
        metadata: {
          kind: change.kind,
          effectiveAt: change.effectiveAt,
          urgent: Boolean(change.urgent),
          ownersNotified: sentHere,
          ownersFailed: failedHere,
        },
        context: SYSTEM_AUDIT_CONTEXT,
      })
    }
  }
  return result
}
