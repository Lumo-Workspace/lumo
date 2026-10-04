import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  requireUserWorkspace,
  serviceErrorResponse,
  zodError,
} from '@/lib/api/helpers'
import { updateTaskTemplateSchema } from '@/lib/validation/task-template'
import { taskTemplateService } from '@/lib/services/task-template.service'

type Params = { params: Promise<{ id: string }> }

/** PATCH /api/task-templates/[id] — edit a workspace template (OWNER only). */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const ws = await requireUserWorkspace(authResult.userId)
    if (ws instanceof NextResponse) return ws

    const body = await request.json().catch(() => null)
    const parsed = updateTaskTemplateSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { id } = await params
    const template = await taskTemplateService.updateTemplate(
      ws.workspaceId,
      ws.member.role,
      id,
      parsed.data
    )
    return NextResponse.json({ template })
  } catch (error) {
    return serviceErrorResponse(error, '[PATCH /api/task-templates/[id]]')
  }
}

/** DELETE /api/task-templates/[id] — remove a workspace template (OWNER only). */
export async function DELETE(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const ws = await requireUserWorkspace(authResult.userId)
    if (ws instanceof NextResponse) return ws

    const { id } = await params
    await taskTemplateService.deleteTemplate(ws.workspaceId, ws.member.role, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return serviceErrorResponse(error, '[DELETE /api/task-templates/[id]]')
  }
}
