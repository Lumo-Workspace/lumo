import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { requireWorkspaceByUrl } from '@/lib/api/helpers'
import { sentryService } from '@/lib/services/sentry.service'
import { createMappingSchema } from '@/lib/validation/sentry.schema'
import { memberAuditContext } from '@/lib/api/audit-context'
import { logger } from '@/lib/logger'

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

    const mappings = await sentryService.listMappings(ws.workspaceId)
    return NextResponse.json(mappings)
  } catch (error) {
    const status = errorStatus(error)
    if (status === 404) {
      return NextResponse.json({ error: 'Not connected' }, { status: 404 })
    }
    logger.error('[sentry/mappings] GET error:', error)
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

    const parsed = createMappingSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const result = await sentryService.createMapping(
      ws.workspaceId,
      memberResult.role,
      parsed.data,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: memberResult.id,
      })
    )
    return NextResponse.json(result)
  } catch (error) {
    const status = errorStatus(error)
    if ([400, 403, 404, 409].includes(status)) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    logger.error('[sentry/mappings] POST error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
