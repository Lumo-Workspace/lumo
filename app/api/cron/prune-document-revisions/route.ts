import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { documentRevisionService } from '@/lib/services'

/**
 * GET /api/cron/prune-document-revisions
 * Daily Vercel Cron. Applies the time-decay retention policy to document
 * revisions (24h keep-all -> 7d daily -> older weekly; first + manual kept).
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const result = await documentRevisionService.pruneRevisions()
  return NextResponse.json(result)
}
