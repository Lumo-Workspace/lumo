import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { projectRepository } from '@/lib/repositories'
import { computeProjectFoldProposals } from '@/lib/services/memory/fold-compute'

export const runtime = 'nodejs'
// The dry-run preview runs the full LLM fold pipeline; give it the platform max.
export const maxDuration = 300

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/projects/[id]/memories/fold-candidates — LUM-553 read-only DRY-RUN
 * preview of the autonomous topic-fold pass: the coarse-card proposals + the
 * source ids each would fold / leave behind. Computes via the LLM, writes
 * nothing. Unlike the human-only merge/retire ACTIONS this is bearer-allowed —
 * it's a preview an agent/CLI is meant to run (`lumo memory fold --dry-run`).
 * The actual folding only ever runs server-side in the daily cron.
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

    const { proposals } = await computeProjectFoldProposals(id)
    return NextResponse.json({ proposals })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error(
      'GET /api/projects/[id]/memories/fold-candidates error:',
      error
    )
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
