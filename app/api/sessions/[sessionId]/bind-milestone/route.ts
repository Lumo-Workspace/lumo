import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { sessionService } from '@/lib/services/session.service'
import { cliCommandNamesFromHeaders } from '@/lib/cli/command-names'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

interface Body {
  milestoneRef?: unknown
}

/**
 * POST /api/sessions/[sessionId]/bind-milestone — bind the session to a
 * MILESTONE as a STEWARD (governance) session (LUM-640). The steward binding
 * is the second legal session form next to the LUM-459 task binding and shares
 * its lifetime-lock semantics; all conflict cases surface as 409 with the
 * current binding named so the CLI can render an actionable message.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { sessionId } = await context.params

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const milestoneRef =
    typeof body.milestoneRef === 'string' ? body.milestoneRef.trim() : ''
  if (!milestoneRef) {
    return NextResponse.json(
      { error: 'milestoneRef is required (milestone id, name, or slug)' },
      { status: 400 }
    )
  }

  try {
    const result = await sessionService.bindSessionToMilestone({
      identity,
      sessionId,
      milestoneRef,
      // LUM-1233: name only the commands the caller's CLI has.
      commands: cliCommandNamesFromHeaders(request.headers),
    })
    return NextResponse.json(result)
  } catch (error) {
    const status = (error as { status?: number } | null)?.status
    if (status === 400 || status === 403 || status === 404) {
      const message = error instanceof Error ? error.message : 'Error'
      return NextResponse.json({ error: message }, { status })
    }
    if (status === 409) {
      const e = error as {
        message?: string
        currentTaskIdentifier?: string
        currentTaskTitle?: string
        currentMilestoneId?: string
        currentMilestoneName?: string
      }
      return NextResponse.json(
        {
          error: e.message ?? 'Session is already bound',
          currentTaskIdentifier: e.currentTaskIdentifier,
          currentTaskTitle: e.currentTaskTitle,
          currentMilestoneId: e.currentMilestoneId,
          currentMilestoneName: e.currentMilestoneName,
        },
        { status: 409 }
      )
    }
    console.error('POST /api/sessions/[sessionId]/bind-milestone error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
