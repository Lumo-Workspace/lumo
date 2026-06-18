import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { projectRepository } from '@/lib/repositories'
import { memorySyncService } from '@/lib/services/memory/memory-sync.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/projects/[id]/memories/sync-bundle
 * The downsync bundle consumed by `lumo memory sync`: ACTIVE project memories,
 * ranked by judge-used 履历 + budget-capped, already in Claude Code local-file
 * shape. Selection/ranking live in the service (single source of truth, shared
 * with injection); this route only authorizes and returns.
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

    const bundle = await memorySyncService.buildBundle(id)
    return NextResponse.json({ bundle })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    console.error('GET /api/projects/[id]/memories/sync-bundle error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
