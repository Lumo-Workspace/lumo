import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'
import { cliDispositionBoundaryCrossingSchema } from '@/lib/validation/boundary-crossing'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; crossingId: string }> }

/**
 * POST /api/tasks/[id]/boundary-crossings/[crossingId]/disposition — the CLI
 * disposition path (LUM-769): `lumo crossing disposition <id> --false-positive |
 * --confirmed --confirm`.
 *
 * Bearer-only, the mirror of the web disposition route: a Clerk (browser)
 * identity is refused 403 BEFORE the body is parsed — a human at the web UI
 * rules in the panel, not through this endpoint. The bearer path exists because
 * the CLI walks the exit-4 confirmation protocol first (the agent prints the
 * crossing — severity, detail, its own explanations — the user approves in
 * chat, the agent re-runs with --confirm). That approval cannot be verified
 * here, so the ruling is recorded with `channel: 'CLI'` on its audit row and
 * surfaced as such in the read model, instead of passing as a web click.
 *
 * Read-then-acknowledge-then-write is server-enforced: the body must carry
 * the STAGE-2 receipt the `--confirm-read` step obtained from
 * `…/disposition/receipt` (missing = 400, strict schema), and the receipt is
 * verified against the crossing as it is NOW — a stage-1 receipt (read but
 * never acknowledged) is 409 "confirm read first"; forged, expired, foreign or
 * stale = 409 too; nothing is written on any refusal. The handshake's
 * timestamps (shown / read acknowledged / confirmed) land on the audit row.
 *
 * Deliberately narrower than the web route: the body can carry only the two
 * clearing values. The OPEN revert and the LUM-751 repository suppression
 * opt-in are unrepresentable on this schema and stay web-only. Task-scoped:
 * a milestone-bound (steward) crossing has no task and is not reachable here.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'bearer') {
    return NextResponse.json(
      {
        error:
          'This is the CLI disposition path (bearer only) — a human at the web UI dispositions a boundary-crossing in the acceptance panel',
      },
      { status: 403 }
    )
  }

  const { id: rawId, crossingId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = cliDispositionBoundaryCrossingSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    // LUM-769 handshake: no valid stage-2 receipt, no write.
    const handshake = await boundaryCrossingService.verifyReadReceipt(
      task.id,
      crossingId,
      parsed.data.disposition,
      parsed.data.receipt,
      {
        sessionId: request.headers.get('X-Lumo-Session-Id'),
        memberId: identity.memberId,
      }
    )
    const outcome = await boundaryCrossingService.disposition(
      task.id,
      crossingId,
      parsed.data.disposition,
      parsed.data.dispositionNote ?? null,
      {
        actorMemberId: identity.memberId,
        actorClerkId: identity.clerkId,
        channel: 'CLI',
        handshake,
      }
    )
    return NextResponse.json({ ...outcome, channel: 'CLI' })
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
