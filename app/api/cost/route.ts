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
  // LUM-1233 3e: `usage show --until` — exclusive upper bound (ISO instant).
  const untilRaw = url.searchParams.get('until')

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
    const until = untilRaw ? new Date(untilRaw) : undefined
    if (until && Number.isNaN(until.getTime())) {
      return NextResponse.json({ error: 'Invalid until date' }, { status: 400 })
    }
    if (since && until && since >= until) {
      return NextResponse.json(
        { error: 'since must be before until' },
        { status: 400 }
      )
    }
    scope = {
      kind: 'workspace',
      ...(since ? { since } : {}),
      ...(until ? { until } : {}),
    }
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
