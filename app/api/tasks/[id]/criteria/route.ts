import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskCriteriaService } from '@/lib/services/task-criteria.service'
import { criteriaSetBodySchema } from '@/lib/validation/acceptance'
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

/** GET /api/tasks/[id]/criteria — the task's acceptance contract. */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTask(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const result = await taskCriteriaService.listForTask(task.id)
  return NextResponse.json(result)
}

/**
 * PUT /api/tasks/[id]/criteria — submit the whole contract.
 * source=AGENT_DRAFT: initial draft, create-only, rejected (409) once any
 * criteria exist (agent lock). source=HUMAN_EDIT: human contract revision
 * expressed as the desired final list; session 出处 comes from the
 * X-Lumo-Session-Id header the CLI sends.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTask(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = criteriaSetBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const result =
      parsed.data.source === 'AGENT_DRAFT'
        ? await taskCriteriaService.submitDraft(task.id, parsed.data.criteria)
        : await taskCriteriaService.reviseAsHuman(
            task.id,
            parsed.data.criteria,
            {
              actorMemberId: identity.memberId,
              sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
            }
          )
    return NextResponse.json(result)
  } catch (error) {
    const maybeStatus = (error as { status?: unknown } | null)?.status
    const status = typeof maybeStatus === 'number' ? maybeStatus : 500
    const message =
      status === 500 || !(error instanceof Error)
        ? 'Internal Server Error'
        : error.message
    return NextResponse.json({ error: message }, { status })
  }
}
