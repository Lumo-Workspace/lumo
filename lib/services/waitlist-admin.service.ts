import { miscRepository } from '@/lib/repositories/misc.repository'
import {
  buildWaitlistApprovedEmail,
  isEmailDelivered,
  sendEmail,
} from '@/lib/integrations/email'
import { resolveAppUrl } from '@/lib/config/public-config'
import { platformAdminAudit } from '@/lib/services/platform-admin-audit.service'

/** LUM-1344: platform admin waitlist management (approve + invite email). */

/**
 * `not_sent`: approve found the entry already approved, so no email went out
 * (resend is the explicit way to send it again).
 */
export type WaitlistEmailOutcome = 'sent' | 'skipped' | 'failed' | 'not_sent'

export interface WaitlistAdminItem {
  id: string
  email: string
  name: string | null
  company: string | null
  teamSize: string | null
  source: 'MARKETING_FORM' | 'ONBOARDING_BLOCKED'
  status: 'PENDING' | 'APPROVED' | 'DISMISSED'
  createdAt: Date
  approvedAt: Date | null
  lastInvitedAt: Date | null
  inviteCount: number
}

export interface WaitlistListQuery {
  status?: 'PENDING' | 'APPROVED' | 'DISMISSED' | undefined
  q?: string | undefined
  cursor?: string | undefined
  limit: number
}

function notFound(): Error {
  return Object.assign(new Error('Waitlist entry not found'), {
    status: 404,
    code: 'WAITLIST_NOT_FOUND',
  })
}

function dismissedError(): Error {
  return Object.assign(
    new Error('Waitlist entry is dismissed; restore it first'),
    { status: 409, code: 'WAITLIST_DISMISSED' }
  )
}

async function requireEntry(id: string): Promise<WaitlistAdminItem> {
  const entry = await miscRepository.findWaitlistEntryById(id)
  if (!entry) throw notFound()
  return entry
}

async function sendApprovalEmail(
  entry: WaitlistAdminItem
): Promise<WaitlistEmailOutcome> {
  const appUrl = resolveAppUrl() ?? 'http://localhost:3000'
  const { subject, html } = buildWaitlistApprovedEmail({
    name: entry.name,
    signInUrl: `${appUrl}/signin`,
  })
  // Unique per call on purpose: each approve/resend is a new email. A double
  // approve is stopped in approve() (it sends only on PENDING -> APPROVED),
  // not by this key.
  const result = await sendEmail(
    { to: [entry.email], subject, html },
    { idempotencyKey: `waitlist-approve/${entry.id}-${Date.now()}` }
  )
  if (isEmailDelivered(result)) {
    await miscRepository.markWaitlistInvited(entry.id)
    return 'sent'
  }
  return result.status === 'skipped' && result.reason === 'not_configured'
    ? 'skipped'
    : 'failed'
}

export const waitlistAdmin = {
  async list(
    q: WaitlistListQuery
  ): Promise<{ items: WaitlistAdminItem[]; nextCursor: string | null }> {
    const fetched = await miscRepository.listWaitlistEntries({
      status: q.status,
      q: q.q,
      cursor: q.cursor,
      take: q.limit + 1,
    })
    const items = fetched.slice(0, q.limit)
    const last = items[items.length - 1]
    return {
      items,
      nextCursor: fetched.length > q.limit && last ? last.id : null,
    }
  },

  async approve(
    id: string,
    adminUserId: string
  ): Promise<{ entry: WaitlistAdminItem; email: WaitlistEmailOutcome }> {
    if ((await requireEntry(id)).status === 'DISMISSED') throw dismissedError()
    // Conditional on PENDING: a double approve never overwrites approvedAt.
    const { count } = await miscRepository.approveWaitlistEntryIfPending(
      id,
      adminUserId
    )
    // Nothing changed and it was dismissed meanwhile: refuse, as above.
    if (count === 0 && (await requireEntry(id)).status === 'DISMISSED') {
      throw dismissedError()
    }
    // Audit before the email: a send/bookkeeping failure must not leave an
    // approval without its audit row. The email outcome lives in the response.
    await platformAdminAudit.record({
      adminUserId,
      action: 'waitlist.approve',
      targetType: 'waitlist',
      targetId: id,
      metadata: { approvedNow: count > 0 },
    })
    const approved = await requireEntry(id)
    if (count === 0) return { entry: approved, email: 'not_sent' }
    const email = await sendApprovalEmail(approved)
    const entry = email === 'sent' ? await requireEntry(id) : approved
    return { entry, email }
  },

  async resend(
    id: string,
    adminUserId: string
  ): Promise<{ entry: WaitlistAdminItem; email: WaitlistEmailOutcome }> {
    const current = await requireEntry(id)
    if (current.status !== 'APPROVED') {
      throw Object.assign(new Error('Waitlist entry is not approved'), {
        status: 409,
        code: 'WAITLIST_NOT_APPROVED',
      })
    }
    await platformAdminAudit.record({
      adminUserId,
      action: 'waitlist.resend',
      targetType: 'waitlist',
      targetId: id,
    })
    const email = await sendApprovalEmail(current)
    const entry = email === 'sent' ? await requireEntry(id) : current
    return { entry, email }
  },

  /**
   * Dismiss PENDING entries (invalid or unwanted sign-ups). No email is sent.
   * Each id is a conditional PENDING -> DISMISSED update of its own, so an
   * entry approved meanwhile is skipped rather than reported; ids that are
   * unknown or not PENDING are skipped, not an error. Each entry actually
   * dismissed gets its own audit row, written right after its update (the
   * same order as approve).
   */
  async dismiss(
    ids: string[],
    adminUserId: string
  ): Promise<{ dismissed: string[] }> {
    const dismissed: string[] = []
    for (const id of new Set(ids)) {
      const { count } = await miscRepository.dismissWaitlistEntryIfPending(id)
      if (count === 0) continue
      await platformAdminAudit.record({
        adminUserId,
        action: 'waitlist.dismiss',
        targetType: 'waitlist',
        targetId: id,
      })
      dismissed.push(id)
    }
    return { dismissed }
  },

  /** Undo a dismiss: DISMISSED -> PENDING. 409 for any other state. */
  async restore(
    id: string,
    adminUserId: string
  ): Promise<{ entry: WaitlistAdminItem }> {
    await requireEntry(id)
    const { count } = await miscRepository.restoreWaitlistEntryIfDismissed(id)
    if (count === 0) {
      throw Object.assign(new Error('Waitlist entry is not dismissed'), {
        status: 409,
        code: 'WAITLIST_NOT_DISMISSED',
      })
    }
    await platformAdminAudit.record({
      adminUserId,
      action: 'waitlist.restore',
      targetType: 'waitlist',
      targetId: id,
    })
    return { entry: await requireEntry(id) }
  },
}
