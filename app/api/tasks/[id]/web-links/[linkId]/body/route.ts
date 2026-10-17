import { NextRequest, NextResponse } from 'next/server'
import { resolveTaskResourceRef } from '@/lib/services/task-resource-ref.service'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskWebLinkService } from '@/lib/services/task-web-link.service'
import { redactWebBodyForInjection } from '@/lib/security-scan/inject-guard'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string; linkId: string }> }

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
 * GET /api/tasks/[id]/web-links/[linkId]/body
 * Tier-2 retrieval for the cheap inline WebLink card (LUM-122). Returns the
 * cached body when present, otherwise the service fetches it behind the SSRF
 * guard (Task 7) and backfills the row. The service also enforces workspace
 * scope (link.task.project.workspaceId === workspaceId), throwing 404 on miss.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id: rawId, linkId: linkIdRef } = await params
    const task = await resolveTask(rawId, identity.workspaceId)
    if (!task)
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    // LUM-1230: short ref / unique prefix / full id, within this task.
    const linkId = await resolveTaskResourceRef('webLink', task.id, linkIdRef)

    const body = await taskWebLinkService.fetchBody(
      identity.workspaceId,
      linkId
    )
    // LUM-784: the body is printed verbatim into the agent's context by
    // `web show` — redact every registry secret on the way out; the count
    // lets the CLI print the notice.
    // LUM-1230: `id` (additive) is the resolved link id, so a CLI that was
    // given a short ref can stamp the lineage pull with the real fragment id.
    return NextResponse.json({ id: linkId, ...redactWebBodyForInjection(body) })
  } catch (err) {
    return errorResponse(err, 'GET /api/tasks/[id]/web-links/[linkId]/body')
  }
}
