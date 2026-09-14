import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { readReceiptRequestSchema } from '@/lib/validation/boundary-crossing'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; crossingId: string }> }

/**
 * POST /api/tasks/[id]/boundary-crossings/[crossingId]/disposition/receipt —
 * the READ and READ-ACKNOWLEDGED steps of the CLI disposition handshake
 * (LUM-769). Bearer-only like the write route.
 *
 * - body `{ disposition }`: stage 1 — the CLI calls it while building the
 *   exit-4 envelope; the server signs the crossing's current state for the
 *   named ruling and this caller (session + member) and returns a stage-1
 *   receipt.
 * - body `{ disposition, acknowledge: <stage-1 receipt> }`: stage 2 — the
 *   user confirmed they read the envelope (`--confirm-read`); the server
 *   verifies the stage-1 receipt against the crossing as it is NOW and returns
 *   the stage-2 receipt the write route requires.
 *
 * Nothing is written by either. The write route refuses any `--confirm` that
 * does not present a stage-2 receipt still matching the crossing — so a ruling
 * can only follow a read AND an acknowledged read, in that order.
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

  const { id: rawId, crossingId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = readReceiptRequestSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const caller = {
      sessionId: request.headers.get('X-Lumo-Session-Id'),
      memberId: identity.memberId,
    }
    const issued = parsed.data.acknowledge
      ? await boundaryCrossingService.acknowledgeReadReceipt(
          task.id,
          crossingId,
          parsed.data.disposition,
          parsed.data.acknowledge,
          caller
        )
      : await boundaryCrossingService.issueReadReceipt(
          task.id,
          crossingId,
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
