import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { prSecurityScanService } from '@/lib/services/pr-security-scan.service'
import { memberAuditContext } from '@/lib/api/audit-context'
import { dispositionSecurityFindingSchema } from '@/lib/validation/security-scan'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; findingId: string }> }

/**
 * POST /api/tasks/[id]/security-findings/[findingId]/disposition — a human
 * marks a security finding FALSE_POSITIVE or ACCEPTED_RISK (LUM-732), which
 * clears its DONE block. RED LINE (same as boundary-crossing disposition): a
 * bearer/agent identity is refused 403 BEFORE the body is parsed — an agent
 * can never disposition a finding on its own PR to unblock its own DONE.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'clerk') {
    return NextResponse.json(
      {
        error:
          'A security finding can only be dispositioned from a human-authenticated browser session — the agent/CLI path is closed by design',
      },
      { status: 403 }
    )
  }

  const { id: rawId, findingId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = dispositionSecurityFindingSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

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
      }
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
