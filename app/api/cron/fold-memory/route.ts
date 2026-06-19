import { NextRequest, NextResponse } from 'next/server'
import { memoryRepository } from '@/lib/repositories/memory.repository'
import { foldService } from '@/lib/services/memory/fold.service'

export const runtime = 'nodejs'

/**
 * GET /api/cron/fold-memory — LUM-553. Daily Vercel Cron. Autonomous memory
 * topic folding: for every project that has ACTIVE PROJECT memory, run the
 * throttled fold pass (`foldService.triggerForProject` self-gates on
 * active-count floor + per-project cooldown + the Layer-2 lease). Per-project
 * best-effort — `triggerForProject` swallows its own errors, and `allSettled`
 * means one project can't abort the sweep.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const projectIds =
    await memoryRepository.findProjectIdsWithActiveProjectMemory()
  const results = await Promise.allSettled(
    projectIds.map(id => foldService.triggerForProject(id))
  )

  const folded = results.reduce(
    (n, r) => n + (r.status === 'fulfilled' ? r.value.folded : 0),
    0
  )
  const failed = results.filter(r => r.status === 'rejected').length

  return NextResponse.json({ projects: projectIds.length, folded, failed })
}
