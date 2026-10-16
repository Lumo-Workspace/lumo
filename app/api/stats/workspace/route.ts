import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { getWorkspaceStats } from '@/lib/services/stats.service'

/**
 * GET /api/stats/workspace — the Dashboard's live stats.
 *
 * LUM-1192: browser session or API key (`lumo workspace overview`). Always
 * the credential's workspace: a Bearer key's own (the `X-Lumo-Workspace`
 * header cannot move it), or the session's active one.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  try {
    const stats = await getWorkspaceStats(identity.workspaceId)
    return NextResponse.json({ stats })
  } catch (error) {
    console.error('GET /api/stats/workspace error:', error)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
