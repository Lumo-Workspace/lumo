import { NextRequest, NextResponse } from 'next/server'
import {
  CODEUP_EVENT_HEADER,
  CODEUP_TOKEN_HEADER,
} from '@/lib/integrations/codeup/webhook'
import { codeupWebhookService } from '@/lib/services/codeup-webhook.service'

/**
 * POST /api/webhooks/codeup — LUM-1315.
 *
 * Deliveries from the per-repository hooks Lumo creates when a workspace
 * confirms a Codeup repository. Authenticated by the hook's own token in
 * `X-Codeup-Token` (Codeup signs nothing), which also says which workspace
 * the delivery is for. Behind `codeup-integration`: outside the rollout the
 * service answers 404 (a body that is not JSON is a 400 first — nothing is
 * read from it before the service decides).
 */
export async function POST(request: NextRequest) {
  let payload: unknown
  try {
    payload = JSON.parse(await request.text())
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const result = await codeupWebhookService.handleDelivery({
    event: request.headers.get(CODEUP_EVENT_HEADER),
    token: request.headers.get(CODEUP_TOKEN_HEADER),
    payload,
  })

  if (result.status === 401) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (result.status === 404) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, outcome: result.outcome })
}
