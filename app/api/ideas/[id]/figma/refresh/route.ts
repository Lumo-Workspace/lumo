import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaFigmaLinkService } from '@/lib/services/idea-figma-link.service'

export const runtime = 'nodejs'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

function errorResponse(err: unknown, tag: string): NextResponse {
  const errStatus = (err as { status?: unknown })?.status
  const status = typeof errStatus === 'number' ? errStatus : 500
  if (status === 500) {
    console.error(`${tag} error:`, err)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
  const message = err instanceof Error ? err.message : 'Error'
  return NextResponse.json({ error: message }, { status })
}

/**
 * POST /api/ideas/[id]/figma/refresh
 *
 * Re-fetches Figma metadata (file name, frame name, thumbnail) for every
 * link attached to the idea. Returns `{ results }` where each entry has
 * `{ id, ok, error? }`. Individual link failures are recorded but do NOT
 * cause the overall request to fail.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id } = await params
    const { ideaId } = await resolveIdeaRef({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })

    const results = await ideaFigmaLinkService.refreshLinksForIdea({
      ideaId,
      workspaceId: identity.workspaceId,
      actorMemberId: identity.memberId,
    })
    return NextResponse.json({ results })
  } catch (error) {
    return errorResponse(error, 'POST /api/ideas/[id]/figma/refresh')
  }
}
