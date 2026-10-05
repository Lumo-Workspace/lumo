import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { memberAuditContext } from '@/lib/api/audit-context'
import { disconnectIntegration } from '@/lib/services/google-drive-integration.service'

export async function DELETE(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const ws = await getUserWorkspace(authResult.userId)
  if (!ws) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  await disconnectIntegration(
    ws.workspaceId,
    ws.member.id,
    memberAuditContext(request.headers, {
      clerkId: authResult.userId,
      memberId: ws.member.id,
    })
  )
  return NextResponse.json({ ok: true })
}
