import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { prisma } from '@/lib/db/prisma'
import { sessionSummaryService } from '@/lib/services/session-summary'

type Params = { params: Promise<{ id: string }> }

interface ErrorLike {
  message?: string
  status?: number
}

/**
 * POST /api/sessions/[id]/summarize
 * Generate (or regenerate) an AI summary of the session and persist it.
 * Returns 404 if the session doesn't exist, 403 if it belongs to a workspace
 * the caller isn't a member of.
 */
export async function POST(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const session = await prisma.session.findUnique({
      where: { id },
      select: { workspaceId: true },
    })
    if (!session) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      session.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const result = await sessionSummaryService.generateSummary({
      sessionId: id,
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
      console.error('POST /api/sessions/[id]/summarize error:', error)
    }
    return NextResponse.json({ error: message }, { status })
  }
}
