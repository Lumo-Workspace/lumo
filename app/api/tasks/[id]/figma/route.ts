import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskFigmaLinkService } from '@/lib/services/task-figma-link.service'
import { addFigmaLinkSchema } from '@/lib/validation/task-figma-link'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

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
    return { id: rawId }
  }
  const parsed = parseIdentifier(rawId)
  if (!parsed) return null
  return taskRepository.findByWorkspaceIdentifier(
    workspaceId,
    parsed.teamIdentifier,
    parsed.number
  )
}

export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTask(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const links = await taskFigmaLinkService.listForTask(task.id)
  return NextResponse.json({ links })
}

export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTask(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = addFigmaLinkSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const link = await taskFigmaLinkService.addFigmaLink({
      taskId: task.id,
      workspaceId: identity.workspaceId,
      actorMemberId: identity.memberId,
      url: parsed.data.url,
    })
    return NextResponse.json({ link }, { status: 201 })
  } catch (e) {
    const err = e as Error & { status?: number; code?: string }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status ?? 500 }
    )
  }
}
