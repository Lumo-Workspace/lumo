import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { projectRepository } from '@/lib/repositories'
import { computeProjectRetireCandidates } from '@/lib/services/memory/retire.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/projects/[id]/memories/retire-candidates — the derived list of the
 * project's ACTIVE memories currently proposed for retirement (LUM-540 P4a),
 * each with its reason(s) (low judged-used track record / curation-judge
 * clearly-wrong). Read-only: candidacy is computed, never persisted, and the
 * actual retire action is the human-only POST .../retire route.
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

    const candidates = await computeProjectRetireCandidates(id)
    return NextResponse.json({ candidates })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error(
      'GET /api/projects/[id]/memories/retire-candidates error:',
      error
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
