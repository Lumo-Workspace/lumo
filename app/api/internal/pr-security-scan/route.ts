import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
/**
 * POST /api/internal/pr-security-scan — per-PR security-scan worker (LUM-732).
 * Mirrors /api/internal/policy-check: a PR webhook or a manual link dispatches
 * exactly one PR here so the diff fetch, secret scan and LLM judge run in a
 * foreground context with a 300s budget, never inline in a ~15s waitUntil.
 *
 * Self-call only: gated by the shared CRON_SECRET.
 */
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { pullRequestId?: unknown; trigger?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const pullRequestId =
    typeof body.pullRequestId === 'string' ? body.pullRequestId : null
  // PR_EVENT is the default: an unknown/absent trigger is a webhook scan.
  const trigger =
    body.trigger === 'PR_LINK' || body.trigger === 'SARIF_PUSH'
      ? body.trigger
      : 'PR_EVENT'
  if (!pullRequestId) {
    return NextResponse.json(
      { error: 'pullRequestId required' },
      { status: 400 }
    )
  }

  try {
    // Dynamic import keeps the service → @ai-sdk/gateway graph out of the
    // static import chain (same pattern as policy-check / run-summary / fold
    // routes). Inside the try so a module-init failure also maps to 502.
    const { prSecurityScanService } =
      await import('@/lib/services/pr-security-scan.service')
    const result = await prSecurityScanService.run({ pullRequestId, trigger })
    if ('skipped' in result) {
      logger.info(
        `[pr-security-scan] skipping pr=${pullRequestId}: ${result.reason}`
      )
    }
    return NextResponse.json(result)
  } catch (error) {
    // A throw before a scan row exists (e.g. fetchPrHeadSha failing) has no
    // row to stamp FAILED — log and return 502 so the caller sees it.
    logger.error(
      `[pr-security-scan] run failed pr=${pullRequestId}:`,
      error instanceof Error ? error.message : error
    )
    return NextResponse.json({ error: 'scan failed' }, { status: 502 })
  }
}
