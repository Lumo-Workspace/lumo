import { NextRequest, NextResponse } from 'next/server'
import { verifyClerkWebhook } from '@/lib/auth/clerk-webhook'
import { logger } from '@/lib/logger'
import { WEBHOOK_AUDIT_CONTEXT } from '@/lib/services/audit.service'
import {
  deprovisionTriggerFromClerkEvent,
  memberDeprovisionService,
} from '@/lib/services/member-deprovision.service'

/**
 * POST /api/webhooks/clerk (LUM-906)
 *
 * Clerk user events. Subscribed: `user.deleted` and `user.updated`; only a
 * deletion or `banned: true` deprovisions (every active membership is
 * deactivated, API keys revoked, audited with the svix-id). Anything else is
 * acknowledged and ignored. A missing / invalid signature is 401; a missing
 * signing secret is a generic 500 ("Webhook unavailable"; the cause is only
 * logged). Processing errors return 500 so Clerk retries —
 * safe, because deprovisioning is idempotent.
 */
export async function POST(request: NextRequest) {
  let event
  try {
    event = await verifyClerkWebhook(request)
  } catch (error) {
    const status = (error as { status?: number }).status ?? 401
    if (status >= 500) {
      // Never tell an unauthenticated caller which configuration is missing.
      logger.error('[clerk/webhook] unavailable', {
        error: (error as Error).message,
      })
      return NextResponse.json(
        { error: 'Webhook unavailable' },
        { status: 500 }
      )
    }
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status })
  }

  const trigger = deprovisionTriggerFromClerkEvent(event, event.webhookId)
  if (!trigger) {
    return NextResponse.json({ ok: true, ignored: event.type })
  }

  try {
    const outcomes = await memberDeprovisionService.deprovisionClerkUser(
      trigger,
      WEBHOOK_AUDIT_CONTEXT
    )
    return NextResponse.json({ ok: true, outcomes })
  } catch (error) {
    logger.error('[clerk/webhook] deprovisioning failed', {
      webhookId: event.webhookId,
      error: (error as Error)?.message ?? String(error),
    })
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
