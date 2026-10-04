import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { summaryService } from '@/lib/services/summary.service'

/**
 * GET /api/summaries/generate
 * Called daily by Vercel Cron. Iterates summary-enabled workspaces and
 * generates project + workspace summaries for any that are due based on
 * their configured frequency.
 */
export async function GET(req: NextRequest) {
  // Fails closed when CRON_SECRET is unset (LUM-981).
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized

  try {
    const results = await summaryService.generateCronSummaries()
    return NextResponse.json({ results })
  } catch (error) {
    console.error('GET /api/summaries/generate error:', error)
    return NextResponse.json(
      { error: 'Failed to generate summaries' },
      { status: 500 }
    )
  }
}
