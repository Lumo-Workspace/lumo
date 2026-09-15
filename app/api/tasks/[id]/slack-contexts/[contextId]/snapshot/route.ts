import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskRepository, taskSlackContextRepository } from '@/lib/repositories'
import { redactSlackSnapshotForInjection } from '@/lib/security-scan/inject-guard'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; contextId: string }> }

function isLikelyCuid(segment: string): boolean {
  return /^c[a-z0-9]{24}$/.test(segment)
}

function parseIdentifier(
  segment: string
): { teamIdentifier: string; number: number } | null {
  const m = /^([A-Za-z]+)-(\d+)$/.exec(segment)
  if (!m) return null
  return { teamIdentifier: m[1]!.toUpperCase(), number: parseInt(m[2]!, 10) }
}

async function resolveTask(rawId: string, workspaceId: string) {
  if (isLikelyCuid(rawId)) {
    return taskRepository.findByIdForMention(rawId, workspaceId)
  }
  const parsed = parseIdentifier(rawId)
  if (!parsed) return null
  return taskRepository.findByWorkspaceIdentifier(
    workspaceId,
    parsed.teamIdentifier,
    parsed.number
  )
}

function errorResponse(err: unknown, route: string) {
  if (err instanceof Error && 'status' in err) {
    return NextResponse.json(
      { error: err.message },
      { status: (err as Error & { status: number }).status }
    )
  }
  console.error(`${route} error:`, err)
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
}

/**
 * GET /api/tasks/[id]/slack-contexts/[contextId]/snapshot
 * Returns the stored Slack thread snapshot (no network call). Tier-2 retrieval
 * for the cheap inline Slack card (LUM-122). Workspace scope is enforced by
 * resolving the task first, then matching the snapshot's taskId.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id: rawId, contextId } = await params
    const task = await resolveTask(rawId, identity.workspaceId)
    if (!task)
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const context = await taskSlackContextRepository.getById(contextId)
    if (!context || context.taskId !== task.id)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // LUM-784: the stored bodies go straight into the agent's context via
    // `slack show` — redact every registry secret on the way out and tell the
    // CLI how many, so it can print the notice.
    const { snapshot, redactedSecrets } = redactSlackSnapshotForInjection(
      context.snapshot
    )
    return NextResponse.json({ snapshot, redactedSecrets })
  } catch (err) {
    return errorResponse(
      err,
      'GET /api/tasks/[id]/slack-contexts/[contextId]/snapshot'
    )
  }
}
