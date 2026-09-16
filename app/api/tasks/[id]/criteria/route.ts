import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { taskCriteriaService } from '@/lib/services/task-criteria.service'
import { criteriaSetBodySchema } from '@/lib/validation/acceptance'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

/** GET /api/tasks/[id]/criteria — the task's acceptance contract. */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const result = await taskCriteriaService.listForTask(task.id)
  // N-5 (whole-branch review, second pass): carry the task's status alongside
  // the contract — already resolved above via `resolveTaskParam`, no extra
  // query — so `lumo task criteria confirm`'s dry-run envelope can pre-check
  // DONE and refuse before promising a write the server's own 409
  // (`taskCriteriaConfirmService.confirmContract`) would refuse anyway.
  return NextResponse.json({ ...result, status: task.status })
}

/**
 * PUT /api/tasks/[id]/criteria — submit the whole contract.
 * source=AGENT_DRAFT: editable while the task is not DONE — free full-replace
 * before work starts (workStartedAt null), identity-preserving diff after work
 * starts, 409 only when the task is DONE (terminal lock). source=HUMAN_EDIT:
 * human contract revision expressed as the desired final list; session 出处
 * comes from the X-Lumo-Session-Id header the CLI sends.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = criteriaSetBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const attribution = {
      actorMemberId: identity.memberId,
      sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
      origin: identity.source === 'clerk' ? ('web' as const) : ('cli' as const),
    }
    const result =
      parsed.data.source === 'AGENT_DRAFT'
        ? await taskCriteriaService.submitDraft(
            task.id,
            parsed.data.criteria,
            attribution,
            task.status,
            task.workStartedAt ?? null
          )
        : await taskCriteriaService.reviseAsHuman(
            task.id,
            parsed.data.criteria,
            attribution,
            task.status,
            parsed.data.causeTag
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
