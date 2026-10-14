import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { memberConnectionService } from '@/lib/services/member-connection.service'
import { logger } from '@/lib/logger'

/**
 * GET /api/workspaces/members/connections — LUM-1136.
 * Per member: coding agents used in the last 30 days with the Lumo CLI and
 * skill versions they reported, plus the latest published CLI version.
 * Visible to every member, like the member list.
 */
export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const view = await memberConnectionService.listConnections(
      identity.workspaceId,
      new Date()
    )
    return NextResponse.json(view)
  } catch (error) {
    logger.error('GET /api/workspaces/members/connections error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
