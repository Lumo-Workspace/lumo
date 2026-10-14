import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/security-findings — every finding on the task's latest
 * scan per linked PR, flat, with its PR number and whether it blocks DONE
 * (LUM-1128). Read-only; the bearer-readable counterpart of
 * `/security-scans`, so `lumo finding disposition` can build its envelope
 * from server state. The task resolves inside the caller's workspace only —
 * another workspace's task is a 404.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  try {
    const findings = await prSecurityScanService.listFindingsForTask(task.id)
    return NextResponse.json({ findings })
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
