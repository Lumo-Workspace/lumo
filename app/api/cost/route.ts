import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import {
  operationCostService,
  type OperationCostScope,
} from '@/lib/services/operation-cost.service'

export async function GET(request: Request): Promise<Response> {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const url = new URL(request.url)
  const task = url.searchParams.get('task')
  const session = url.searchParams.get('session')
  const sinceRaw = url.searchParams.get('since')

  if (task && session) {
    return NextResponse.json(
      { error: 'Pass at most one of task / session' },
      { status: 400 }
    )
  }

  let scope: OperationCostScope
  if (task) {
    scope = { kind: 'task', identifier: task }
  } else if (session) {
    scope = { kind: 'session', sessionId: session }
  } else {
    const since = sinceRaw ? new Date(sinceRaw) : undefined
    if (since && Number.isNaN(since.getTime())) {
      return NextResponse.json({ error: 'Invalid since date' }, { status: 400 })
    }
    scope = { kind: 'workspace', ...(since ? { since } : {}) }
  }

  const result = await operationCostService.getOperationCost(
    identity.workspaceId,
    scope
  )
  if (!result) {
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  }
  return NextResponse.json(result)
}
