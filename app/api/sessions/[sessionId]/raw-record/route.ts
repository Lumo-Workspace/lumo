import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { sessionRawRecordService } from '@/lib/services/session-raw-record.service'
import { deleteSessionRawRecordSchema } from '@/lib/validation/schemas'
import { logger } from '@/lib/logger'
import { memberAuditContext } from '@/lib/api/audit-context'

type Params = { params: Promise<{ sessionId: string }> }

function errorResponse(error: unknown, where: string) {
  if (error instanceof Error && 'status' in error) {
    return NextResponse.json(
      { error: error.message },
      { status: (error as Error & { status: number }).status }
    )
  }
  logger.error(`${where} /api/sessions/[sessionId]/raw-record error`, error)
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
}

/** Signed-in member of the session's workspace, or the response to return. */
async function resolveViewer(sessionId: string) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const session = await sessionRepository.findWorkspaceId(sessionId)
  if (!session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const member = await requireWorkspaceMember(
    session.workspaceId,
    authResult.userId
  )
  if (member instanceof NextResponse) return member
  return {
    workspaceMemberId: member.id,
    workspaceId: member.workspaceId,
    role: member.role,
  }
}

/**
 * GET /api/sessions/[sessionId]/raw-record — what deleting this session's raw
 * record would clear (LUM-944). `canDelete: false` (and zero counts) for a
 * workspace member who is neither the session's member nor an OWNER.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const { sessionId } = await params
    const viewer = await resolveViewer(sessionId)
    if (viewer instanceof NextResponse) return viewer
    return NextResponse.json(
      await sessionRawRecordService.getStatus(sessionId, viewer)
    )
  } catch (error) {
    return errorResponse(error, 'GET')
  }
}

/**
 * DELETE /api/sessions/[sessionId]/raw-record — clear the raw hook payloads
 * of the session and its subagent sessions, one batched pass per call
 * (`done: false` → call again with `after: cursor`). The session's member or
 * a workspace OWNER; anyone else 403 (LUM-944).
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { sessionId } = await params
    const viewer = await resolveViewer(sessionId)
    if (viewer instanceof NextResponse) return viewer

    const text = await request.text()
    let body: unknown = {}
    try {
      body = text ? JSON.parse(text) : {}
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }
    const parsed = deleteSessionRawRecordSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const result = await sessionRawRecordService.deleteRawRecord(
      sessionId,
      viewer,
      {
        after: parsed.data.after ?? null,
        audit: memberAuditContext(request.headers, {
          memberId: viewer.workspaceMemberId,
        }),
      }
    )
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error, 'DELETE')
  }
}
