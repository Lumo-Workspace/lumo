import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { sessionRepository } from '@/lib/repositories/session.repository'
import { sessionSummaryService } from '@/lib/services/session-summary'

type Params = { params: Promise<{ sessionId: string }> }

interface ErrorLike {
  message?: string
  status?: number
  code?: string
}

/**
 * POST /api/sessions/[sessionId]/summarize
 * Generate (or regenerate) an AI summary of the session and persist it.
 * Returns 404 if the session doesn't exist, 403 if it belongs to a workspace
 * the caller isn't a member of.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { sessionId } = await params

    const session = await sessionRepository.findWorkspaceId(sessionId)
    if (!session) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      session.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const result = await sessionSummaryService.generateSummary({
      sessionId,
      workspaceMemberId: memberResult.id,
    })

    return NextResponse.json({
      summaryType: result.summaryType,
      summary: result.summary,
      generatedAt: result.generatedAt.toISOString(),
      eventCount: result.eventCount,
    })
  } catch (error) {
    const err = error as ErrorLike
    const status = typeof err.status === 'number' ? err.status : 500
    const message = err.message ?? 'Internal Server Error'
    if (status >= 500) {
      console.error('POST /api/sessions/[sessionId]/summarize error:', error)
    }
    return NextResponse.json(
      { error: message, ...(err.code ? { code: err.code } : {}) },
      { status }
    )
  }
}
