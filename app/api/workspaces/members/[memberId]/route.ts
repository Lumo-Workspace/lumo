import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { updateMemberRoleSchema } from '@/lib/validation/schemas'
import { memberService } from '@/lib/services/member.service'
import { memberAuditContext } from '@/lib/api/audit-context'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws

    const { memberId } = await params

    const body = await request.json()
    const parsed = updateMemberRoleSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const { role } = parsed.data

    const updated = await memberService.updateMemberRole(
      memberId,
      role,
      ws.member.id,
      ws.member.role,
      ws.workspaceId,
      memberAuditContext(request.headers, {
        clerkId: userId,
        memberId: ws.member.id,
      })
    )

    return NextResponse.json({ member: updated })
  } catch (error) {
    const status = (error as { status?: number }).status
    if (status) {
      return NextResponse.json({ error: (error as Error).message }, { status })
    }
    console.error('PATCH /api/workspaces/members/[memberId] error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
