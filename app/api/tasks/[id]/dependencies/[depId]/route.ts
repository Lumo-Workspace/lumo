import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskDependencyService } from '@/lib/services/task-dependency.service'
import { patchDependencyBodySchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string; depId: string }> }

/** Returns true when the segment looks like a Prisma cuid (c + 24 alphanum chars). */
function isLikelyCuid(segment: string): boolean {
  return /^c[a-z0-9]{24}$/.test(segment)
}

/**
 * Parse a "LUM-42"-style identifier into its components.
 * Returns null if the string doesn't match the pattern.
 */
function parseIdentifier(
  segment: string
): { teamIdentifier: string; number: number } | null {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(segment)
  if (!m) return null
  return { teamIdentifier: m[1]!.toUpperCase(), number: parseInt(m[2]!, 10) }
}

/**
 * Resolve the `[id]` route param to a canonical task cuid, scoped to the
 * caller's workspace. Accepts both cuids and "LUM-N" identifiers.
 */
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

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id: rawId, depId } = await params
    const task = await resolveTask(rawId, identity.workspaceId)
    if (!task)
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    // Ownership check: ensure this edge belongs to the task
    const edges = await taskDependencyService.listForTask(task.id)
    if (!edges.some(e => e.id === depId))
      return NextResponse.json({ error: 'Dependency not found' }, { status: 404 })

    const body = await request.json().catch(() => null)
    const parsed = patchDependencyBodySchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const dependency =
      parsed.data.action === 'confirm'
        ? await taskDependencyService.confirm({ edgeId: depId, reverse: parsed.data.reverse })
        : await taskDependencyService.dismiss(depId)

    return NextResponse.json({ dependency })
  } catch (err) {
    return errorResponse(err, 'PATCH /api/tasks/[id]/dependencies/[depId]')
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id: rawId, depId } = await params
    const task = await resolveTask(rawId, identity.workspaceId)
    if (!task)
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    // Ownership check: ensure this edge belongs to the task
    const edges = await taskDependencyService.listForTask(task.id)
    if (!edges.some(e => e.id === depId))
      return NextResponse.json({ error: 'Dependency not found' }, { status: 404 })

    await taskDependencyService.remove(depId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'DELETE /api/tasks/[id]/dependencies/[depId]')
  }
}
