import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaFigmaLinkService } from '@/lib/services/idea-figma-link.service'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; linkId: string }> }

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
 * DELETE /api/ideas/[id]/figma/[linkId]
 *
 * Idempotent: `linkId` may be a cuid or a Figma URL — the service resolves
 * which. Returns 200 `{ ok: true }` in both cases (including not-found).
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id, linkId } = await params
    const { ideaId } = await resolveIdeaRef({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })

    await ideaFigmaLinkService.removeFigmaLink({
      input: linkId,
      ideaId,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'DELETE /api/ideas/[id]/figma/[linkId]')
  }
}
