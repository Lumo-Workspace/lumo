import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { inviteService } from '@/lib/services/invite.service'
import { memberAuditContext } from '@/lib/api/audit-context'
import { logger } from '@/lib/logger'

/**
 * LUM-1017: every non-2xx answer from this route is
 * `{ ok: false, error, code }` so the client can pick a message by `code`.
 * The resend button exists only to deliver the email, so a send that did not
 * happen is an error, not `ok`. The service extends the invite's expiry only
 * on `sent`; on failed / skipped the invite keeps its old expiry.
 */
const RESEND_EMAIL_ERRORS = {
  failed: {
    status: 502,
    code: 'EMAIL_SEND_FAILED',
    error: 'The invite email could not be sent',
  },
  skipped: {
    status: 503,
    code: 'EMAIL_NOT_CONFIGURED',
    error: 'Email delivery is not configured on this server',
  },
} as const

const CODE_BY_STATUS: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
}

function failure(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, error, code }, { status })
}

/** Re-shape a shared helper's early-return response so it carries a code. */
async function withCode(res: NextResponse) {
  const body = (await res
    .clone()
    .json()
    .catch(() => ({}))) as { error?: unknown; code?: unknown }
  return failure(
    res.status,
    typeof body.code === 'string'
      ? body.code
      : (CODE_BY_STATUS[res.status] ?? 'REQUEST_FAILED'),
    typeof body.error === 'string' ? body.error : 'Request failed'
  )
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return withCode(authResult)
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return withCode(ws)

    const { token } = await params

    const { outcome } = await inviteService.resendInvite(
      token,
      ws.workspaceId,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: ws.member.id,
      })
    )

    if (outcome !== 'sent') {
      const { status, code, error } = RESEND_EMAIL_ERRORS[outcome]
      return failure(status, code, error)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const { status, code } = error as { status?: unknown; code?: unknown }
    if (typeof status === 'number') {
      return failure(
        status,
        typeof code === 'string'
          ? code
          : (CODE_BY_STATUS[status] ?? 'REQUEST_FAILED'),
        (error as Error).message
      )
    }
    logger.error('POST /api/invites/[token]/resend error', {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    })
    return failure(500, 'INTERNAL_ERROR', 'Internal Server Error')
  }
}
