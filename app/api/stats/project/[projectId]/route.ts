import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { loadProjectForIdentity } from '@/lib/api/helpers'
import { getProjectStats } from '@/lib/services/stats.service'

/**
 * GET /api/stats/project/[projectId] — the project page's live stats.
 *
 * LUM-1192: browser session or API key (`lumo project overview`). A project
 * outside the credential's workspace answers 404, like a missing one.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { projectId } = await params

  const result = await loadProjectForIdentity(projectId, identity)
  if (result instanceof NextResponse) return result
  const { project } = result

  try {
    const stats = await getProjectStats(projectId, project.workspaceId)
    return NextResponse.json({ stats })
  } catch (error) {
    console.error(`GET /api/stats/project/${projectId} error:`, error)
    return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 })
  }
}
