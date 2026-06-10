import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { taskVerificationService } from '@/lib/services/task-verification.service'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/status — the acceptance-status read model (LUM-344):
 * the full contract with latest verdicts, the verification history,
 * currentRound, the last round's failure reasons, and nextActions. Pure
 * read (no writes, no LLM) — the agent's self-check entry point, consumed
 * by `lumo task status`.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const status = await taskVerificationService.statusForTask(task.id)
  return NextResponse.json(status)
}
