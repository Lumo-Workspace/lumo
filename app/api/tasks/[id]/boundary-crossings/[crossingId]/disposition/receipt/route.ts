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
 * the READ step of the CLI disposition handshake (LUM-769). Bearer-only like
 * the write route. The CLI calls it while building the exit-4 envelope; the
 * server signs the crossing's current state for the named ruling and this
 * caller (session + member) and returns a short receipt. Nothing is written.
 * The write route refuses any `--confirm` that does not present a receipt
 * still matching the crossing — so a ruling can only follow a read.
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
    const issued = await boundaryCrossingService.issueReadReceipt(
      task.id,
      crossingId,
      parsed.data.disposition,
      {
        sessionId: request.headers.get('X-Lumo-Session-Id'),
        memberId: identity.memberId,
      }
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
