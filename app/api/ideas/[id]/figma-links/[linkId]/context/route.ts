import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaFigmaLinkRepository } from '@/lib/repositories'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; linkId: string }> }

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
 * GET /api/ideas/[id]/figma-links/[linkId]/context
 * Tier-2 retrieval for the cheap inline Figma card on an idea. Mirrors
 * `app/api/tasks/[id]/figma-links/[linkId]/context/route.ts` (LUM-122),
 * adapted to the idea team-scoped auth pattern (LUM-681).
 *
 * Returns the already-stored design metadata for the link (fileName/frameName/
 * url/thumbnailUrl + last sync info). Live, full design context (layer trees,
 * variables, code-connect) requires the Figma MCP server and is not available
 * through this endpoint, so we surface a `designContextAvailable: false` flag
 * with a note rather than fabricating data.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id, linkId } = await params
    const { ideaId } = await resolveIdeaRef({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })

    const link = await ideaFigmaLinkRepository.findById(linkId)
    if (!link || link.ideaId !== ideaId)
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
      'GET /api/ideas/[id]/figma-links/[linkId]/context'
    )
  }
}
