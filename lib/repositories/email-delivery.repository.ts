import { Prisma, type EmailDeliveryStatus } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

/**
 * LUM-1041: the `email_deliveries` idempotency ledger.
 *
 * Not workspace-scoped, deliberately: EmailDelivery has no workspaceId column
 * (it is keyed only by the caller's idempotency key, and system emails such
 * as invites and owner / subprocessor notices are cross-workspace), so it is
 * not in WORKSPACE_SCOPED_MODELS and these queries use the plain client with
 * no workspace filter. The rows hold no recipient address or content.
 */

export type EmailClaim =
  | { claimed: true; attempt: number }
  | {
      claimed: false
      /** What holds the key: an earlier SENT, or a send still in flight. */
      status: Extract<EmailDeliveryStatus, 'SENT' | 'SENDING'>
      messageId: string | null
    }

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  )
}

export const emailDeliveryRepository = {
  /**
   * Atomically take the right to send under `idempotencyKey`.
   *
   * New key → insert a SENDING row (the unique index decides any race).
   * Existing key → claimable only when FAILED, or SENDING with
   * `attemptStartedAt` before `staleBefore` (a crashed send); the takeover is
   * a compare-and-swap on (status, attempts), so of N concurrent reclaimers
   * exactly one wins. SENT, or a fresh SENDING, is not claimable.
   */
  async claim(
    idempotencyKey: string,
    staleBefore: Date,
    now: Date = new Date()
  ): Promise<EmailClaim> {
    try {
      const row = await prisma.emailDelivery.create({
        data: { idempotencyKey, status: 'SENDING', attemptStartedAt: now },
        select: { attempts: true },
      })
      return { claimed: true, attempt: row.attempts }
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
    }

    const row = await prisma.emailDelivery.findUnique({
      where: { idempotencyKey },
      select: {
        status: true,
        attempts: true,
        attemptStartedAt: true,
        messageId: true,
      },
    })
    if (!row) {
      throw new Error('email_deliveries row vanished during claim')
    }
    const reclaimable =
      row.status === 'FAILED' ||
      (row.status === 'SENDING' && row.attemptStartedAt < staleBefore)
    if (!reclaimable) {
      return {
        claimed: false,
        status: row.status === 'SENT' ? 'SENT' : 'SENDING',
        messageId: row.messageId,
      }
    }

    const attempt = row.attempts + 1
    const { count } = await prisma.emailDelivery.updateMany({
      where: { idempotencyKey, status: row.status, attempts: row.attempts },
      data: {
        status: 'SENDING',
        attempts: attempt,
        attemptStartedAt: now,
        errorCode: null,
      },
    })
    if (count === 1) return { claimed: true, attempt }
    // Another sender reclaimed it first.
    return { claimed: false, status: 'SENDING', messageId: null }
  },

  /**
   * Settle this attempt's claim as SENT. Compare-and-swap on
   * (key, SENDING, attempts = this attempt): a late, superseded attempt
   * (judged stale and reclaimed) never overwrites a newer attempt's state,
   * messageId or sentAt. Returns false when the claim was no longer this
   * attempt's.
   */
  async markSent(
    idempotencyKey: string,
    attempt: number,
    messageId: string | null,
    now: Date = new Date()
  ): Promise<boolean> {
    const { count } = await prisma.emailDelivery.updateMany({
      where: { idempotencyKey, status: 'SENDING', attempts: attempt },
      data: { status: 'SENT', sentAt: now, messageId, errorCode: null },
    })
    return count === 1
  },

  /**
   * Settle this attempt's claim as FAILED (frees the key for a retry). Same
   * compare-and-swap as markSent; false when the claim was superseded.
   */
  async markFailed(
    idempotencyKey: string,
    attempt: number,
    errorCode: string | null
  ): Promise<boolean> {
    const { count } = await prisma.emailDelivery.updateMany({
      where: { idempotencyKey, status: 'SENDING', attempts: attempt },
      data: { status: 'FAILED', errorCode },
    })
    return count === 1
  },
}
