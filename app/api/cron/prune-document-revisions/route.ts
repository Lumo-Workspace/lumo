import { NextRequest, NextResponse } from 'next/server'
import { documentRevisionService } from '@/lib/services'

/**
 * GET /api/cron/prune-document-revisions
 * Daily Vercel Cron. Applies the time-decay retention policy to document
 * revisions (24h keep-all -> 7d daily -> older weekly; first + manual kept).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await documentRevisionService.pruneRevisions()
  return NextResponse.json(result)
}
