import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { logger } from '@/lib/logger'
import { runTaskTitleEmbeddingBackfill } from '@/lib/services/task-embedding.service'
import { taskTitleEmbeddingBackfillQuerySchema } from '@/lib/validation/task-title-embedding-backfill'

export const runtime = 'nodejs'
/** The run stops itself before this; the next scheduled run resumes. */
export const maxDuration = 300
const TIME_BUDGET_MS = 240_000

/**
 * GET /api/cron/backfill-task-title-embeddings — LUM-1286, temporary.
 *
 * Embeds the titles of live tasks created before Task.titleEmbedding existed,
 * so duplicate checks can recall them. Runs inside Vercel because only the
 * deployment holds the production database and AI Gateway credentials. Gated
 * by CRON_SECRET; scheduled in vercel.json so it needs no manual call. Writes
 * by default (only NULL rows, so re-runs are no-ops once done); `?dryRun=1`
 * only reports the count. Remove the schedule once `missingAfter` stays 0.
 */
export async function GET(req: NextRequest) {
  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized
  const parsed = taskTitleEmbeddingBackfillQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', issues: parsed.error.issues },
      { status: 400 }
    )
  }
  try {
    const report = await runTaskTitleEmbeddingBackfill({
      dryRun: parsed.data.dryRun,
      deadline: new Date(Date.now() + TIME_BUDGET_MS),
    })
    return NextResponse.json(report)
  } catch (err) {
    logger.error('[cron] backfill-task-title-embeddings failed:', err)
    return NextResponse.json({ error: 'Backfill failed' }, { status: 500 })
  }
}
