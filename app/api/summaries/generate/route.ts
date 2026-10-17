import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { summaryService } from '@/lib/services/summary.service'

/**
 * GET /api/summaries/generate
 * Called daily by Vercel Cron. Prunes generation-job rows older than 7 days.
 *
 * LUM-1228: it no longer generates anything. Its only remaining job was the
 * workspace briefing (one LLM call per workspace per cycle), whose readers —
 * the Dashboard page and `lumo workspace overview` — are gone. The path is
 * kept so the existing cron entry keeps pruning.
 */
export async function GET(req: NextRequest) {
  // Fails closed when CRON_SECRET is unset (LUM-981).
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized

  try {
    const pruned = await summaryService.pruneGenerationJobs()
    return NextResponse.json({ pruned })
  } catch (error) {
    console.error('GET /api/summaries/generate error:', error)
    return NextResponse.json(
      { error: 'Failed to prune generation jobs' },
      { status: 500 }
    )
  }
}
