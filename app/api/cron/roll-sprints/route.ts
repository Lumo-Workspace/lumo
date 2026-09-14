import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/api/cron-auth'
import { teamRepository } from '@/lib/repositories/team.repository'
import { sprintService } from '@/lib/services/sprint.service'

/**
 * GET /api/cron/roll-sprints
 * Called daily by Vercel Cron. Rolls each sprints-enabled team's sprint state
 * forward to the current date: activates the DRAFT whose window has begun and
 * closes the ACTIVE one whose window has ended (unfinished tasks → backlog).
 *
 * The same reconcile runs opportunistically on sprint read paths; this cron is
 * the no-traffic safety net so transitions (and their notifications) fire even
 * when nobody opens the app.
 */
export async function GET(req: NextRequest) {  const unauthorized = requireCronAuth(req)
  if (unauthorized) return unauthorized

  const teamIds = await teamRepository.listSprintsEnabledIds()
  const results = await Promise.allSettled(
    teamIds.map(id => sprintService.reconcileSprintStates(id))
  )

  const reconciled = results.filter(r => r.status === 'fulfilled').length
  const failed = results.length - reconciled

  return NextResponse.json({ teams: teamIds.length, reconciled, failed })
}
