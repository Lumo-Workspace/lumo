import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaWebLinkService } from '@/lib/services/idea-web-link.service'

export const runtime = 'nodejs'
export const maxDuration = 60

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

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id, linkId } = await params
    await resolveIdeaRef({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })

    const webLink = await ideaWebLinkService.refreshWebLink(
      linkId,
      identity.workspaceId
    )
    return NextResponse.json({ webLink })
  } catch (error) {
    return errorResponse(
      error,
      'POST /api/ideas/[id]/web-links/[linkId]/refresh'
    )
  }
}
