import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { getProjectStats } from '@/lib/services/stats.service'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const { projectId } = await params

  const result = await loadProjectAndMember(projectId, userId)
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
