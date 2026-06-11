import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/boundary-crossings — the task's open (unacknowledged)
 * forbidden-action crossings, feeding the AcceptanceTab panel (LUM-426).
 * Read-only and workspace-scoped; any authenticated identity may read (the
 * acknowledge POST is the human-only write path).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const crossings = await boundaryCrossingService.listOpen(task.id)
  return NextResponse.json({ crossings })
}
