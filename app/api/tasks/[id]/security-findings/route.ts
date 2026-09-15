import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { securityFindingCliDispositionService } from '@/lib/services/security-finding-cli-disposition.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/security-findings — every finding on the task's latest
 * scan per linked PR, flat, with its PR number (LUM-750). Read-only; the
 * bearer-readable counterpart of `/security-scans` so `lumo finding
 * disposition` can read the row it is about to show in its envelope. Both
 * identities may read; only the human panel and the receipt-gated CLI path
 * may write.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  try {
    const view = await securityFindingCliDispositionService.listForTask(task.id)
    return NextResponse.json(view)
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
