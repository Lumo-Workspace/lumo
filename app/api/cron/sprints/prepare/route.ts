import { NextRequest, NextResponse } from 'next/server'
import { sprintPrepareService } from '@/lib/services'

/**
 * GET /api/cron/sprints/prepare
 * Called daily by Vercel Cron. Prepares draft sprints for all eligible teams.
 */
export async function GET(req: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { processed, failures } = await sprintPrepareService.prepareAll()

  return NextResponse.json({ processed, failures })
}
