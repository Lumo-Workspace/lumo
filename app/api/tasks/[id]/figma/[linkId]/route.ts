import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskFigmaLinkService } from '@/lib/services/task-figma-link.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; linkId: string }> }

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
 * DELETE /api/tasks/[id]/figma/[linkId]
 *
 * Idempotent: `linkId` may be a cuid or a Figma URL — the service resolves
 * which. Returns 200 `{ ok: true }` in both cases (including not-found).
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId, linkId } = await params
  const task = await resolveTask(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  await taskFigmaLinkService.removeFigmaLink({
    input: linkId,
    taskId: task.id,
  })
  return NextResponse.json({ ok: true })
}
