import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { memberAuditContext } from '@/lib/api/audit-context'
import { figmaIntegrationRepository } from '@/lib/repositories/figma-integration.repository'
import { disconnectIntegration } from '@/lib/services/figma-integration.service'

async function resolveWorkspaceAndMember(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return { error: authResult }
  const { userId } = authResult
  const workspaceUrl = request.nextUrl.searchParams.get('workspaceUrl')
  if (!workspaceUrl) {
    return {
      error: NextResponse.json(
        { error: 'workspaceUrl is required' },
        { status: 400 }
      ),
    }
  }
  const ws = await getUserWorkspace(userId)
  if (!ws || ws.workspace.slug !== workspaceUrl) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ws, userId }
}

export async function GET(request: NextRequest) {
  const r = await resolveWorkspaceAndMember(request)
  if (r.error) return r.error
  const row = await figmaIntegrationRepository.findByMember(
    r.ws!.workspaceId,
    r.ws!.member.id
  )
  if (!row) return NextResponse.json({ connected: false })
  return NextResponse.json({
    connected: true,
    handle: row.figmaHandle,
    email: row.figmaEmail,
    needsReauth: row.needsReauth,
  })
}

export async function DELETE(request: NextRequest) {
  const r = await resolveWorkspaceAndMember(request)
  if (r.error) return r.error
  await disconnectIntegration(
    r.ws!.workspaceId,
    r.ws!.member.id,
    memberAuditContext(request.headers, {
      clerkId: r.userId,
      memberId: r.ws!.member.id,
    })
  )
  return NextResponse.json({ ok: true })
}
