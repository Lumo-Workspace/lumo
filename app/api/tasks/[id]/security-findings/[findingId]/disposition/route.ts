import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'
import { memberAuditContext } from '@/lib/api/audit-context'
import { dispositionSecurityFindingSchema } from '@/ee/security/validation/security-scan'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; findingId: string }> }

/**
 * POST /api/tasks/[id]/security-findings/[findingId]/disposition — mark a
 * security finding FALSE_POSITIVE or ACCEPTED_RISK (LUM-732), which clears
 * its DONE block.
 *
 * LUM-1128: two surfaces, one route, split by `identity.source` (the LUM-812
 * test-case pattern — both surfaces record the same rulings, so there is no
 * narrower CLI schema to keep apart):
 *
 *   - Clerk → `channel: 'WEB'`, the delivery panel.
 *   - bearer → `channel: 'CLI'`, `lumo finding disposition`, which only sends
 *     this after the user approved its exit-4 confirmation envelope (LUM-755
 *     protocol) and the agent re-ran it with `--confirm`.
 *
 * No identity guard: LUM-750's "refuse inside an agent session" was reverted
 * (PR 1006) — the user's workflow is to approve in chat and let the agent
 * relay. The protection is the confirmation protocol plus the channel trail.
 * Either surface may change an existing ruling, so the web panel can correct
 * a CLI ruling.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId, findingId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = dispositionSecurityFindingSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const viaCli = identity.source === 'bearer'
  try {
    const view = await prSecurityScanService.disposition(
      task.id,
      findingId,
      parsed.data.disposition,
      parsed.data.note ?? null,
      identity.memberId,
      {
        workspaceId: identity.workspaceId,
        context: memberAuditContext(
          request.headers,
          { clerkId: identity.clerkId, memberId: identity.memberId },
          identity.source
        ),
      },
      {
        channel: viaCli ? 'CLI' : 'WEB',
        sessionId: viaCli ? request.headers.get('X-Lumo-Session-Id') : null,
      }
    )
    return NextResponse.json({ ...view, channel: viaCli ? 'CLI' : 'WEB' })
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
