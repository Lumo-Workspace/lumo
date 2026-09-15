import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { securityFindingCliDispositionService } from '@/lib/services/security-finding-cli-disposition.service'
import { cliBulkDispositionSecurityFindingsSchema } from '@/lib/validation/security-scan'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/[id]/security-findings/bulk-disposition/cli — the CLI bulk
 * write (LUM-750): `lumo finding disposition --all-suggested-fp --confirm`.
 * Bearer-only (the Clerk web bulk route lives one level up); requires the
 * stage-2 receipt bound to the suggested set as it is NOW (409 otherwise,
 * nothing written). Touches exactly the suggested-false-positive rows.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'bearer') {
    return NextResponse.json(
      {
        error:
          'This is the CLI disposition path (bearer only) — a human at the web UI confirms the suggested false positives in the delivery panel',
      },
      { status: 403 }
    )
  }

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = cliBulkDispositionSecurityFindingsSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const sessionId = request.headers.get('X-Lumo-Session-Id')
    const handshake =
      await securityFindingCliDispositionService.verifyBulkReadReceipt(
        task.id,
        parsed.data.receipt,
        { sessionId, memberId: identity.memberId }
      )
    const result =
      await securityFindingCliDispositionService.dispositionSuggested(task.id, {
        actorMemberId: identity.memberId,
        sessionId,
        handshake,
      })
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
