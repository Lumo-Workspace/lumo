import { NextRequest, NextResponse } from 'next/server'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { foldService } from '@/lib/services/memory/fold.service'

export const runtime = 'nodejs'
// The fold pipeline runs many LLM calls per project; give it the platform max.
export const maxDuration = 300

/**
 * GET /api/cron/fold-memory — LUM-553. Daily Vercel Cron. Autonomous memory
 * topic folding: for every project that has ACTIVE PROJECT memory, run the
 * throttled fold pass (`foldService.triggerForProject` self-gates on over-cap +
 * per-project cooldown + the Layer-2 lease, and bounds itself to K clusters).
 *
 * Projects are processed SEQUENTIALLY so total LLM concurrency stays at the
 * per-project cap (FOLD_CONCURRENCY) rather than multiplying across projects.
 * `triggerForProject` swallows its own errors, so one project can't abort the
 * sweep; if the function's time budget is exhausted, the remaining projects are
 * simply picked up on the next daily run (idempotent, cooldown-gated).
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const projectIds =
    await memoryRepository.findProjectIdsWithActiveProjectMemory()

  let folded = 0
  let failed = 0
  for (const id of projectIds) {
    try {
      folded += (await foldService.triggerForProject(id)).folded
    } catch {
      failed++ // defensive — triggerForProject already swallows its own errors
    }
  }

  return NextResponse.json({ projects: projectIds.length, folded, failed })
}
