import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import {
  taskStatusService,
  withLegacyV1Fields,
} from '@/lib/services/task-status.service'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/status — the task-status read model (LUM-344): rework,
 * cost, claim, security findings and test-case advisories. Pure read (no
 * writes, no LLM) — the agent's self-check entry point, consumed by
 * `lumo task status`.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const status = await taskStatusService.statusForTask(
    task.id,
    identity.workspaceId
  )
  return NextResponse.json(withLegacyV1Fields(status))
}
