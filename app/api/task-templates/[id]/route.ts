import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { serviceErrorResponse, zodError } from '@/lib/api/helpers'
import { updateTaskTemplateSchema } from '@/lib/validation/task-template'
import { taskTemplateService } from '@/lib/services/task-template.service'
import { memberAuditContext } from '@/lib/api/audit-context'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/task-templates/[id] — edit a workspace template (OWNER only).
 * Browser session or CLI bearer (`lumo task template edit`, LUM-974; the CLI
 * resolves the key to this id via GET /api/task-templates).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const body = await request.json().catch(() => null)
    const parsed = updateTaskTemplateSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { id } = await params
    const role = await taskTemplateService.memberRole(identity.memberId)
    const template = await taskTemplateService.updateTemplate(
      identity.workspaceId,
      role,
      id,
      parsed.data,
      memberAuditContext(
        request.headers,
        { clerkId: identity.clerkId, memberId: identity.memberId },
        identity.source
      )
    )
    return NextResponse.json({ template })
  } catch (error) {
    return serviceErrorResponse(error, '[PATCH /api/task-templates/[id]]')
  }
}

/**
 * DELETE /api/task-templates/[id] — remove a workspace template (OWNER only).
 * Browser session or CLI bearer (`lumo task template rm`, LUM-974).
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  try {
    const { id } = await params
    const role = await taskTemplateService.memberRole(identity.memberId)
    await taskTemplateService.deleteTemplate(
      identity.workspaceId,
      role,
      id,
      memberAuditContext(
        request.headers,
        { clerkId: identity.clerkId, memberId: identity.memberId },
        identity.source
      )
    )
    return NextResponse.json({ success: true })
  } catch (error) {
    return serviceErrorResponse(error, '[DELETE /api/task-templates/[id]]')
  }
}
