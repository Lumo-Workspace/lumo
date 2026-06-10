import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { taskHumanVerdictService } from '@/lib/services/task-human-verdict.service'
import { humanVerdictBodySchema } from '@/lib/validation/acceptance'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/[id]/human-verdict — record a human adjudication of the
 * task's acceptance contract (Slice 2 data half).
 *
 * RED LINE (milestone rule 5): an agent can never write a human verdict.
 * Bearer-token identities — the agent/CLI authentication path — are refused
 * with 403 BEFORE the body is even parsed; only a Clerk browser session (a
 * human at the web UI) gets through. The machine write path
 * (POST /api/tasks/[id]/verify) stays strictly MACHINE; the two paths can
 * never express each other's verifierType.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'clerk') {
    return NextResponse.json(
      {
        error:
          'Human verdicts can only be recorded from a human-authenticated browser session — the agent/CLI path is closed by design',
      },
      { status: 403 }
    )
  }

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = humanVerdictBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const outcome = await taskHumanVerdictService.recordHumanVerdict(
      task.id,
      parsed.data,
      {
        actorMemberId: identity.memberId,
        actorClerkId: identity.clerkId,
      }
    )
    return NextResponse.json(outcome)
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
