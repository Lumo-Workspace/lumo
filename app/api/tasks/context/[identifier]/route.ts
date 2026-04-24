import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { taskContextService } from '@/lib/services/task-context.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

export async function GET(
  request: Request,
  context: { params: Promise<{ identifier: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { identifier } = await context.params
  const result = await taskContextService.getContextForIdentifier(
    identity.workspace.id,
    identifier
  )
  if (!result) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
