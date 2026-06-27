import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { fidelityChangePatternService } from '@/lib/services/fidelity-change-pattern.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/fidelity — the LUM-610 mechanical change-pattern
 * read-out for a task: per delivery snapshot (LUM-609), the grounding
 * composition of the frozen contract (grounded / self-confirming /
 * inconclusive + full effective-kind tally) and the independence signal
 * (criteria ADDED/UPDATED after work started = backward-inference suspects).
 * A composition table, not a single score; no direction verdict. Read-only.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const report = await fidelityChangePatternService.forTask(
    task.id,
    task.workStartedAt
  )
  return NextResponse.json(report)
}
