import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaWebLinkService } from '@/lib/services/idea-web-link.service'
import { createWebLinkBodySchema } from '@/lib/validation/idea-evidence'
import { zodError } from '@/lib/api/helpers'

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

export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(_request)
    if (identity instanceof NextResponse) return identity

    const { id } = await params
    const { ideaId } = await resolveIdeaRef({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })

    const webLinks = await ideaWebLinkService.listForIdea(ideaId)
    return NextResponse.json({ webLinks })
  } catch (error) {
    return errorResponse(error, 'GET /api/ideas/[id]/web-links')
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id } = await params

    const body = await request.json()
    const parsed = createWebLinkBodySchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const webLink = await ideaWebLinkService.addWebLink({
      ideaRef: id,
      workspaceId: identity.workspaceId,
      url: parsed.data.url,
      actorMemberId: identity.memberId,
    })
    return NextResponse.json({ webLink }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'POST /api/ideas/[id]/web-links')
  }
}
