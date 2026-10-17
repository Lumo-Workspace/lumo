import { NextRequest, NextResponse } from 'next/server'
import { resolveTaskResourceRef } from '@/lib/services/task-resource-ref.service'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskArtifactService } from '@/lib/services/task-artifact.service'
import { updateArtifactBodySchema } from '@/lib/validation/task-artifact'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string; artifactId: string }> }

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

function errorResponse(err: unknown, route: string) {
  if (err instanceof Error && 'status' in err) {
    return NextResponse.json(
      { error: err.message },
      { status: (err as Error & { status: number }).status }
    )
  }
  console.error(`${route} error:`, err)
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id: rawId, artifactId: artifactIdRef } = await params
    const task = await resolveTask(rawId, identity.workspaceId)
    if (!task)
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    // LUM-1230: short ref / unique prefix / full id, within this task.
    const artifactId = await resolveTaskResourceRef(
      'artifact',
      task.id,
      artifactIdRef
    )

    const artifact = await taskArtifactService.getById(task.id, artifactId)
    return NextResponse.json({ artifact })
  } catch (err) {
    return errorResponse(err, 'GET /api/tasks/[id]/artifacts/[artifactId]')
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id: rawId, artifactId: artifactIdRef } = await params
    const task = await resolveTask(rawId, identity.workspaceId)
    if (!task)
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    // LUM-1230: short ref / unique prefix / full id, within this task.
    const artifactId = await resolveTaskResourceRef(
      'artifact',
      task.id,
      artifactIdRef
    )

    const body = await request.json().catch(() => null)
    const parsed = updateArtifactBodySchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const artifact = await taskArtifactService.updateArtifact(
      task.id,
      artifactId,
      parsed.data
    )
    return NextResponse.json({ artifact })
  } catch (err) {
    return errorResponse(err, 'PATCH /api/tasks/[id]/artifacts/[artifactId]')
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id: rawId, artifactId: artifactIdRef } = await params
    const task = await resolveTask(rawId, identity.workspaceId)
    if (!task)
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    // LUM-1230: short ref / unique prefix / full id, within this task.
    const artifactId = await resolveTaskResourceRef(
      'artifact',
      task.id,
      artifactIdRef
    )

    await taskArtifactService.removeArtifact(task.id, artifactId)
    return new NextResponse(null, { status: 204 })
  } catch (err) {
    return errorResponse(err, 'DELETE /api/tasks/[id]/artifacts/[artifactId]')
  }
}
