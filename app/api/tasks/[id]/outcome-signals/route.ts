import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { outcomeWellService } from '@/lib/services/outcome-well.service'
import { recordOutcomeSignalSchema } from '@/lib/validation/outcome'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/outcome-signals — read the post-hoc outcome well for a
 * task (LUM-598): the falsifier verdict (REJECTED | INCONCLUSIVE — never a
 * "pass") plus the backing rejection signals.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const well = await outcomeWellService.readWell(task.id)
  return NextResponse.json(well)
}

/**
 * POST /api/tasks/[id]/outcome-signals — record one human-observed post-hoc
 * rejection of the delivery. Append-only: every POST inserts a new signal.
 *
 * The well is a FALSIFIER: this records that reality rejected the delivery
 * (revert / rollback / CI regression / downstream redirect / bypass). There is
 * deliberately no "mark satisfied" counterpart — absence of a rejection is not
 * a pass. `note` is mandatory (the observed referent).
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = recordOutcomeSignalSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const authorSessionId = request.headers.get('X-Lumo-Session-Id')

  try {
    const signal = await outcomeWellService.recordManual({
      workspaceId: identity.workspaceId,
      taskId: task.id,
      kind: parsed.data.kind,
      note: parsed.data.note,
      occurredAt: parsed.data.occurredAt
        ? new Date(parsed.data.occurredAt)
        : null,
      recordedByMemberId: identity.memberId,
      sessionId: authorSessionId,
    })
    return NextResponse.json({ signal, verdict: 'REJECTED' }, { status: 201 })
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
