import { NextRequest, NextResponse } from 'next/server'
import { resolveTaskResourceRef } from '@/lib/services/task-resource-ref.service'
import { requireIdentity } from '@/lib/auth'
import { taskRepository } from '@/lib/repositories'
import { taskFigmaLinkRepository } from '@/lib/repositories/task-figma-link.repository'

export const runtime = 'nodejs'

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
 * GET /api/tasks/[id]/figma-links/[linkId]/context
 * Tier-2 retrieval for the cheap inline Figma card (LUM-122).
 *
 * Returns the already-stored design metadata for the link (fileName/frameName/
 * url/thumbnailUrl + last sync info). Live, full design context (layer trees,
 * variables, code-connect) requires the Figma MCP server and is not available
 * through this endpoint, so we surface a `designContextAvailable: false` flag
 * with a note rather than fabricating data. Cards already trigger a lazy
 * metadata refresh on `task context`; this route is a read of that cache.
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
    const linkId = await resolveTaskResourceRef('figmaLink', task.id, linkIdRef)

    const link = await taskFigmaLinkRepository.findById(linkId)
    if (!link || link.taskId !== task.id)
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      metadata: {
        id: link.id,
        url: link.url,
        fileKey: link.fileKey,
        nodeId: link.nodeId,
        fileName: link.fileName,
        frameName: link.frameName,
        thumbnailUrl: link.thumbnailUrl,
        thumbnailFetchedAt: link.thumbnailFetchedAt,
        lastSyncedAt: link.lastSyncedAt,
        lastSyncError: link.lastSyncError,
      },
      designContextAvailable: false,
      note: 'Live Figma design context (layers, variables, code connect) requires the Figma MCP server and is not exposed by this endpoint. Returned values are the cached design metadata.',
    })
  } catch (err) {
    return errorResponse(
      err,
      'GET /api/tasks/[id]/figma-links/[linkId]/context'
    )
  }
}
