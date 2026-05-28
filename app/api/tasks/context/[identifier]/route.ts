import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { taskContextService } from '@/lib/services/task-context.service'

export async function GET(
  request: Request,
  context: { params: Promise<{ identifier: string }> }
): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { identifier } = await context.params
  const result = await taskContextService.getContextForIdentifier(
    identity.workspaceId,
    identity.memberId,
    identifier
  )
  if (!result) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
