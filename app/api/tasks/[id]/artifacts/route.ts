import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskArtifactService } from '@/lib/services/task-artifact.service'
import { createArtifactBodySchema } from '@/lib/validation/task-artifact'
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
 * caller's workspace. Accepts both cuids and "LUM-N" identifiers. Returns
 * null if the segment does not resolve to a task inside `workspaceId` —
 * critically, the cuid branch verifies workspace ownership so a malicious
 * caller cannot reach a task in another workspace by passing its raw cuid.
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

export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTask(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const artifacts = await taskArtifactService.listForTask(task.id)
  return NextResponse.json({ artifacts })
}

export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTask(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = createArtifactBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const artifact = await taskArtifactService.addArtifact({
    taskId: task.id,
    workspaceId: identity.workspaceId,
    kind: parsed.data.kind,
    title: parsed.data.title,
    content: parsed.data.content,
    source: parsed.data.source,
    actorMemberId: identity.memberId,
  })
  return NextResponse.json({ artifact }, { status: 201 })
}
