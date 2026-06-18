import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { getHumanActorId } from '@/lib/actor'
import { projectRepository, taskRepository } from '@/lib/repositories'
import { memorySyncService } from '@/lib/services/memory/memory-sync.service'

/**
 * Build the routing anchor for a recipient (P2): the text of their active
 * (assigned, not-DONE) tasks in this project. Empty string when they have none
 * — the service then falls back to the full budget-capped set.
 */
async function buildRoutingAnchor(
  memberId: string,
  projectId: string
): Promise<string> {
  const actorId = await getHumanActorId(memberId)
  if (!actorId) return ''
  const tasks = await taskRepository.findAssignedTasks(actorId)
  return tasks
    .filter(t => t.projectId === projectId && t.status !== 'DONE')
    .map(t => `${t.title}\n${t.description ?? ''}`)
    .join('\n\n')
    .trim()
}

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

    const anchorText = await buildRoutingAnchor(identity.memberId, id)
    const bundle = await memorySyncService.buildBundle(
      id,
      anchorText ? { routing: { anchorText } } : {}
    )
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
