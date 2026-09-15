import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { securityFindingCliDispositionService } from '@/lib/services/security-finding-cli-disposition.service'
import { findingReadReceiptRequestSchema } from '@/lib/validation/security-scan'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; findingId: string }> }

/**
 * POST /api/tasks/[id]/security-findings/[findingId]/disposition/receipt —
 * the READ and READ-ACKNOWLEDGED steps of the CLI finding-disposition
 * handshake (LUM-750; the finding twin of the LUM-769 crossing route).
 * Bearer-only, like the write route. Nothing is written by either step.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'bearer') {
    return NextResponse.json(
      {
        error:
          'Read receipts belong to the CLI disposition path (bearer only) — the web panel dispositions directly',
      },
      { status: 403 }
    )
  }

  const { id: rawId, findingId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = findingReadReceiptRequestSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const caller = {
      sessionId: request.headers.get('X-Lumo-Session-Id'),
      memberId: identity.memberId,
    }
    const issued = parsed.data.acknowledge
      ? await securityFindingCliDispositionService.acknowledgeReadReceipt(
          task.id,
          findingId,
          parsed.data.disposition,
          parsed.data.acknowledge,
          caller
        )
      : await securityFindingCliDispositionService.issueReadReceipt(
          task.id,
          findingId,
          parsed.data.disposition,
          caller
        )
    return NextResponse.json(issued)
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
