/**
 * LUM-906 PR2 — verifying Clerk webhook deliveries.
 *
 * Wraps `verifyWebhook` from `@clerk/nextjs/webhooks` (Standard Webhooks /
 * Svix: the `svix-id`, `svix-timestamp` and `svix-signature` headers, a
 * 5-minute timestamp tolerance) so routes depend on this module, not the
 * SDK. The signing secret is the Clerk dashboard endpoint's secret in
 * CLERK_WEBHOOK_SIGNING_SECRET; it is never in code.
 */
import type { NextRequest } from 'next/server'
import { verifyWebhook } from '@clerk/nextjs/webhooks'

export const CLERK_WEBHOOK_SECRET_ENV = 'CLERK_WEBHOOK_SIGNING_SECRET'

export interface VerifiedClerkWebhook {
  type: string
  data: unknown
  /** The delivery id (svix-id); the same across redeliveries of one event. */
  webhookId: string | null
}

/**
 * Verify a Clerk webhook request and return its event. Throws a
 * `{ status: 500 }` error when the secret is not configured, and a
 * `{ status: 401 }` one for a missing, invalid or stale signature.
 */
export async function verifyClerkWebhook(
  request: NextRequest
): Promise<VerifiedClerkWebhook> {
  const signingSecret = process.env[CLERK_WEBHOOK_SECRET_ENV]
  if (!signingSecret) {
    throw Object.assign(
      new Error('Clerk webhook signing secret is not configured'),
      { status: 500 }
    )
  }
  try {
    const event = await verifyWebhook(request, { signingSecret })
    return {
      type: event.type,
      data: event.data,
      webhookId: request.headers.get('svix-id'),
    }
  } catch {
    throw Object.assign(new Error('Invalid webhook signature'), {
      status: 401,
    })
  }
}
