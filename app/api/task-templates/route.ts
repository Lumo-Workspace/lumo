import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireIdentity } from '@/lib/auth'
import {
  requireUserWorkspace,
  serviceErrorResponse,
  zodError,
} from '@/lib/api/helpers'
import { createTaskTemplateSchema } from '@/lib/validation/task-template'
import { taskTemplateService } from '@/lib/services/task-template.service'

/**
 * GET /api/task-templates — system + workspace task templates (LUM-970).
 * Browser session or CLI bearer (`lumo task template list`). `?locale=`
 * picks the system templates' guidance language; without it the caller's
 * saved preference is used.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const templates = await taskTemplateService.listTemplates(
      identity.workspaceId,
      {
        locale: request.nextUrl.searchParams.get('locale'),
        memberId: identity.memberId,
      }
    )
    return NextResponse.json({ templates })
  } catch (error) {
    return serviceErrorResponse(error, '[GET /api/task-templates]')
  }
}

/** POST /api/task-templates — create a workspace template (OWNER only). */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const ws = await requireUserWorkspace(authResult.userId)
    if (ws instanceof NextResponse) return ws

    const body = await request.json().catch(() => null)
    const parsed = createTaskTemplateSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const template = await taskTemplateService.createTemplate(
      ws.workspaceId,
      ws.member.role,
      parsed.data
    )
    return NextResponse.json({ template }, { status: 201 })
  } catch (error) {
    return serviceErrorResponse(error, '[POST /api/task-templates]')
  }
}
