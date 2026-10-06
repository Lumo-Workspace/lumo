import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { prCommentAuthorBackfillService } from '@/lib/services/pr-comment-author-backfill.service'
import { prCommentAuthorBackfillQuerySchema } from '@/lib/validation/pr-comment-author-backfill'

export const runtime = 'nodejs'
/** The run stops itself before this and hands back a cursor. */
export const maxDuration = 300
const TIME_BUDGET_MS = 240_000

/**
 * GET /api/cron/backfill-pr-comment-author-association — LUM-1003, one-off
 * operator backfill (deliberately NOT scheduled in vercel.json).
 *
 * Fills `PrCommentMirror.authorAssociation` for rows mirrored before LUM-1003
 * by reading the PR's comments through the GitHub App installation, which
 * only the deployed server holds credentials for. Gated by the shared
 * CRON_SECRET. Dry run unless `?dryRun=0`; resume with `?cursor=<nextCursor>`.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const parsed = prCommentAuthorBackfillQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  const report = await prCommentAuthorBackfillService.run({
    dryRun: parsed.data.dryRun,
    cursor: parsed.data.cursor ?? null,
    ...(parsed.data.maxPrs ? { maxPrs: parsed.data.maxPrs } : {}),
    deadline: new Date(Date.now() + TIME_BUDGET_MS),
  })
  return NextResponse.json(report)
}
