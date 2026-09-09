import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { sarifIngestJobSchema } from '@/lib/validation/security-sarif'

export const runtime = 'nodejs'
/**
 * POST /api/internal/security-sarif-ingest — per-report SARIF ingest worker
 * (LUM-735). Mirrors /api/internal/pr-security-scan: the upload/complete
 * routes dispatch exactly one job here so the blob fetch, gunzip, parse and
 * diff-aware normalization run in a foreground context with a 300s budget
 * instead of inline in the caller's short-lived request.
 *
 * Self-call only: gated by the shared CRON_SECRET.
 */
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = sarifIngestJobSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid job' }, { status: 400 })
  }

  try {
    // Dynamic import keeps this route's static graph light (same pattern as
    // pr-security-scan / policy-check): the service pulls in the SARIF
    // parser, diff fetch and repositories, none of which belong on the hot
    // path of routes that never call it.
    const { securitySarifIngestService } =
      await import('@/lib/services/security-sarif-ingest.service')
    // FAILED is a normal outcome here — the failure is already stamped onto
    // the scan row, so the caller (dispatch, best-effort) just needs a 200.
    const result = await securitySarifIngestService.ingest(parsed.data)
    return NextResponse.json(result)
  } catch (error) {
    logger.error(
      '[security-sarif-ingest] worker failed:',
      error instanceof Error ? error.message : error
    )
    return NextResponse.json({ error: 'ingest failed' }, { status: 502 })
  }
}
