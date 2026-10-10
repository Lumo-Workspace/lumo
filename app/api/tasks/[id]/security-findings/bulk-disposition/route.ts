import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'
import { memberAuditContext } from '@/lib/api/audit-context'
import { bulkDispositionSecurityFindingsSchema } from '@/ee/security/validation/security-scan'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/tasks/[id]/security-findings/bulk-disposition — a human confirms
 * every finding on the task the falsifier suggested as a false positive
 * (LUM-740). RED LINE (same as the single disposition route): a bearer/agent
 * identity is refused 403 BEFORE the body is parsed — an agent can never
 * bulk-clear the suggestions on its own PR to unblock its own DONE.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'clerk') {
    return NextResponse.json(
      {
        error:
          'Security findings can only be dispositioned from a human-authenticated browser session — the agent/CLI path is closed by design',
      },
      { status: 403 }
    )
  }

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = bulkDispositionSecurityFindingsSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const result = await prSecurityScanService.dispositionSuggested(
      task.id,
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
