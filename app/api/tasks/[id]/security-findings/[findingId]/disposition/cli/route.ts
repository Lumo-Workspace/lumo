import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { securityFindingCliDispositionService } from '@/lib/services/security-finding-cli-disposition.service'
import { cliDispositionSecurityFindingSchema } from '@/lib/validation/security-scan'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; findingId: string }> }

/**
 * POST /api/tasks/[id]/security-findings/[findingId]/disposition/cli — the
 * CLI write of the finding-disposition handshake (LUM-750):
 * `lumo finding disposition <id> --false-positive | --accept-risk --confirm`.
 *
 * Bearer-only, the mirror of the Clerk-only web route one level up: a browser
 * identity is refused 403 BEFORE the body is parsed. The body must carry the
 * STAGE-2 receipt the `--confirm-read` step obtained from `…/disposition/receipt`
 * (missing = 400, strict schema); it is verified against the finding as it is
 * NOW — a stage-1 receipt is 409 "confirm read first", anything forged,
 * expired, foreign or stale is 409 too, and nothing is written on refusal.
 * The ruling lands with `channel: 'CLI'` and the handshake times on its audit
 * row. The CLI itself refuses to run inside an agent session; a disposition
 * that gets through anyway is recorded as SELF_DISPOSITION and rolled back.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'bearer') {
    return NextResponse.json(
      {
        error:
          'This is the CLI disposition path (bearer only) — a human at the web UI dispositions a security finding in the delivery panel',
      },
      { status: 403 }
    )
  }

  const { id: rawId, findingId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = cliDispositionSecurityFindingSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const sessionId = request.headers.get('X-Lumo-Session-Id')
    const handshake =
      await securityFindingCliDispositionService.verifyReadReceipt(
        task.id,
        findingId,
        parsed.data.disposition,
        parsed.data.receipt,
        { sessionId, memberId: identity.memberId }
      )
    const view = await securityFindingCliDispositionService.disposition(
      task.id,
      findingId,
      parsed.data.disposition,
      parsed.data.note ?? null,
      { actorMemberId: identity.memberId, sessionId, handshake }
    )
    return NextResponse.json(view)
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
