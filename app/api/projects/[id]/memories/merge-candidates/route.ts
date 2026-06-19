import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { projectRepository } from '@/lib/repositories'
import { computeProjectMergeProposals } from '@/lib/services/memory/batch-consolidate.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/projects/[id]/memories/merge-candidates — the derived near-dup merge
 * proposals for the project's ACTIVE PROJECT-scope memories (LUM-541 P5): each
 * cluster's canonical-keep id + the supersede-set, plus the live near-dup
 * cluster count. Read-only — candidacy is computed, never persisted; the actual
 * merge is the human-only POST .../merge route.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const project = await projectRepository.findWorkspaceId(id)
    if (!project)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (project.workspaceId !== identity.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const report = await computeProjectMergeProposals(id)
    return NextResponse.json({
      candidates: report.mergeProposals,
      clusterCount: report.nearDupClusterCount,
    })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error(
      'GET /api/projects/[id]/memories/merge-candidates error:',
      error
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
