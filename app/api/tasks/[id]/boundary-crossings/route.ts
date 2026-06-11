import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { boundaryCrossingService } from '@/lib/services/boundary-crossing.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/boundary-crossings — ALL of the task's forbidden-action
 * crossings, open and dispositioned (LUM-435), feeding the AcceptanceTab panel.
 * Dispositioned crossings stay on record (never hidden). Read-only and
 * workspace-scoped; any authenticated identity may read the full detail (the
 * disposition POST is the human-only write path).
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const crossings = await boundaryCrossingService.listAll(task.id)
  return NextResponse.json({ crossings })
}
