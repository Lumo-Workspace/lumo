import { NextRequest, NextResponse } from 'next/server'
import { securitySarifIngestService } from '@/lib/services/security-sarif-ingest.service'

/**
 * GET /api/cron/prune-security-sarif
 * Daily Vercel Cron. Deletes any `security-sarif/` blob older than 24h — a
 * report whose ingest never completed (parse failure, worker crash) that a
 * human never got around to inspecting.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await securitySarifIngestService.pruneStaleBlobs()
  return NextResponse.json(result)
}
