import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { securityFindingCliDispositionService } from '@/lib/services/security-finding-cli-disposition.service'
import { bulkFindingReadReceiptRequestSchema } from '@/lib/validation/security-scan'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/[id]/security-findings/bulk-disposition/receipt — the READ
 * / READ-ACKNOWLEDGED steps of the bulk (`--all-suggested-fp`) handshake
 * (LUM-750). Bearer-only. The receipt binds the SET of suggested-false-
 * positive rows on the task's latest scans; the response lists those rows so
 * the envelope shows exactly what the write will touch. Nothing is written.
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

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = bulkFindingReadReceiptRequestSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const caller = {
      sessionId: request.headers.get('X-Lumo-Session-Id'),
      memberId: identity.memberId,
    }
    const issued = parsed.data.acknowledge
      ? await securityFindingCliDispositionService.acknowledgeBulkReadReceipt(
          task.id,
          parsed.data.acknowledge,
          caller
        )
      : await securityFindingCliDispositionService.issueBulkReadReceipt(
          task.id,
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
