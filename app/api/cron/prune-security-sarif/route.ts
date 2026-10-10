import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { securitySarifIngestService } from '@/ee/security/services/security-sarif-ingest.service'

/**
 * GET /api/cron/prune-security-sarif
 * Daily Vercel Cron — the orphan backstop, not the normal cleanup path. Each
 * durable ingest run deletes its own blob: immediately once the report is
 * persisted, and after a 24h `sleep` when the ingest failed (so a human can
 * still fetch the report first). This sweep only catches `security-sarif/`
 * blobs older than 48h — longer than that sleep, so a run always deletes its
 * own blob first — i.e. blobs that never got a run at all:
 *   - an invalid `tokenPayload` in the upload route's `onUploadCompleted`,
 *   - `start()` failing on both completion paths (upload callback and
 *     `POST …/sarif/complete`),
 *   - local dev, where the blob webhook does not fire and no `complete` call
 *     ever arrives.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const result = await securitySarifIngestService.pruneStaleBlobs()
  return NextResponse.json(result)
}
