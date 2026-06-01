import { NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'
import { getStatus } from '@/lib/services/google-drive-integration.service'

export async function GET() {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const ws = await getUserWorkspace(authResult.userId)
  if (!ws) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const status = await getStatus(ws.workspaceId, ws.member.id)
  return NextResponse.json(status)
}
