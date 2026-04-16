import { NextRequest, NextResponse } from 'next/server'
import { sentryService } from '@/lib/services/sentry.service'

/**
 * POST /api/webhooks/sentry
 *
 * Receives Sentry Internal Integration webhooks. The orgSlug is extracted
 * from the payload's web_url host; the signature is verified with the
 * stored clientSecret. Unrecognized orgs → 404; bad signature → 401;
 * successful deliveries (including "skipped: no_mapping") → 200.
 * Internal errors after auth return 200 to prevent retry storms; they
 * are logged for investigation.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get('sentry-hook-signature')

  try {
    const result = await sentryService.handleWebhook({ rawBody, signature })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 400 || status === 401 || status === 404) {
      return NextResponse.json({ error: (err as Error).message }, { status })
    }
    console.error('[sentry/webhook] internal error:', err)
    return NextResponse.json({ ok: true })
  }
}
