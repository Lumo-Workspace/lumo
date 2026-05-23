import { NextRequest, NextResponse } from 'next/server'
import { layer2Service } from '@/lib/services/memory/layer2.service'

/**
 * GET /api/cron/consolidate-memory
 *
 * Called daily by Vercel Cron (see vercel.json). Runs Layer 2 memory
 * consolidation across every project that has TASK-scope memory: scans
 * recurring patterns and promotes them to PROJECT scope. Idempotent — a
 * second run on the same data emits NOOPs.
 *
 * Authentication is the same shared-secret check used by the other cron
 * routes (`CRON_SECRET` env var, Authorization: Bearer header).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await layer2Service.runConsolidation()

  const totals = result.projects.reduce(
    (acc, p) => ({
      added: acc.added + p.added,
      updated: acc.updated + p.updated,
      noop: acc.noop + p.noop,
      skipped: acc.skipped + p.skipped,
      failed: acc.failed + (p.error ? 1 : 0),
    }),
    { added: 0, updated: 0, noop: 0, skipped: 0, failed: 0 }
  )

  return NextResponse.json({
    projectsProcessed: result.projects.length,
    projectsSkipped: result.skippedProjects.length,
    totals,
    projects: result.projects,
  })
}
