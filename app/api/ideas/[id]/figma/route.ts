import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaFigmaLinkService } from '@/lib/services/idea-figma-link.service'
import { addFigmaLinkSchema } from '@/lib/validation/idea-evidence'
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

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id } = await params
    const { ideaId } = await resolveIdeaRef({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })

    const links = await ideaFigmaLinkService.listForIdea(ideaId)
    return NextResponse.json({ links })
  } catch (error) {
    return errorResponse(error, 'GET /api/ideas/[id]/figma')
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id } = await params

    const body = await request.json().catch(() => null)
    const parsed = addFigmaLinkSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const link = await ideaFigmaLinkService.addFigmaLink({
      ideaRef: id,
      workspaceId: identity.workspaceId,
      actorMemberId: identity.memberId,
      url: parsed.data.url,
    })
    return NextResponse.json({ link }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'POST /api/ideas/[id]/figma')
  }
}
