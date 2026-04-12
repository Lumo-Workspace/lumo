import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { getWorkspaceStats } from '@/lib/services/stats.service'

export async function GET(_req: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const wsResult = await requireUserWorkspace(userId)
  if (wsResult instanceof NextResponse) return wsResult

  try {
    const stats = await getWorkspaceStats(wsResult.workspace.id)
    return NextResponse.json({ stats })
  } catch (error) {
    console.error('GET /api/stats/workspace error:', error)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
