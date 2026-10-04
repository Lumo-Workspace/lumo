import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { sentryService } from '@/lib/services/sentry.service'
import { connectSentrySchema } from '@/lib/validation/sentry.schema'
import { memberAuditContext } from '@/lib/api/audit-context'

function errorStatus(err: unknown): number {
  return (err as { status?: number }).status ?? 500
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const status = await sentryService.getIntegrationStatus(ws.workspaceId)
    return NextResponse.json(status)
  } catch (error) {
    console.error('[sentry/integration] GET error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    const json = await request.json()
    const parsed = connectSentrySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const result = await sentryService.connectIntegration(
      ws.workspaceId,
      memberResult.id,
      memberResult.role,
      parsed.data,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: memberResult.id,
      })
    )
    return NextResponse.json({ success: true, id: result.id })
  } catch (error) {
    const status = errorStatus(error)
    if (status === 403 || status === 404 || status === 409) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('[sentry/integration] POST error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireWorkspaceByUrl(
      userId,
      request.nextUrl.searchParams.get('workspaceUrl')
    )
    if (ws instanceof NextResponse) return ws

    const memberResult = await requireWorkspaceMember(ws.workspaceId, userId)
    if (memberResult instanceof NextResponse) return memberResult

    await sentryService.disconnectIntegration(
      ws.workspaceId,
      memberResult.role,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: memberResult.id,
      })
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    const status = errorStatus(error)
    if (status === 403 || status === 404) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('[sentry/integration] DELETE error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
