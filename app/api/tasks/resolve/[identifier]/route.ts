import { NextResponse } from 'next/server'
import { verifyBearer } from '@/lib/auth/bearer'
import { taskService } from '@/lib/services/task.service'

const UNAUTHORIZED = { error: 'Invalid or revoked API key' }

export async function GET(
  request: Request,
  context: { params: Promise<{ identifier: string }> }
): Promise<Response> {
  const identity = await verifyBearer(request)
  if (!identity) return NextResponse.json(UNAUTHORIZED, { status: 401 })

  const { identifier } = await context.params
  const task = await taskService.resolveIdentifier(
    identity.workspace.id,
    identifier
  )
  if (!task) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  return NextResponse.json(task)
}
