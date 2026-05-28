import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskFigmaLinkService } from '@/lib/services/task-figma-link.service'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

/** Returns true when the segment looks like a Prisma cuid (c + 24 alphanum chars). */
function isLikelyCuid(segment: string): boolean {
  return /^c[a-z0-9]{24}$/.test(segment)
}

function parseIdentifier(
  segment: string
): { teamIdentifier: string; number: number } | null {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(segment)
  if (!m) return null
  return { teamIdentifier: m[1]!.toUpperCase(), number: parseInt(m[2]!, 10) }
}

async function resolveTask(rawId: string, workspaceId: string) {
  if (isLikelyCuid(rawId)) {
    return taskRepository.findByIdForMention(rawId, workspaceId)
  }
  const parsed = parseIdentifier(rawId)
  if (!parsed) return null
  return taskRepository.findByWorkspaceIdentifier(
    workspaceId,
    parsed.teamIdentifier,
    parsed.number
  )
}

/**
 * POST /api/tasks/[id]/figma/refresh
 *
 * Re-fetches Figma metadata (file name, frame name, thumbnail) for every
 * link attached to the task. Returns `{ results }` where each entry has
 * `{ id, ok, error? }`. Individual link failures are recorded but do NOT
 * cause the overall request to fail.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTask(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  try {
    const results = await taskFigmaLinkService.refreshLinksForTask({
      taskId: task.id,
      workspaceId: identity.workspaceId,
      actorMemberId: identity.memberId,
    })
    return NextResponse.json({ results })
  } catch (e) {
    const err = e as Error & { status?: number; code?: string }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status ?? 500 }
    )
  }
}
