import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaSlackContextService } from '@/lib/services/idea-slack-context.service'
import { linkSlackContextBodySchema } from '@/lib/validation/idea-evidence'
import { zodError } from '@/lib/api/helpers'

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

    const contexts = await ideaSlackContextService.listForIdea(ideaId)
    return NextResponse.json({ contexts })
  } catch (error) {
    return errorResponse(error, 'GET /api/ideas/[id]/slack-contexts')
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id } = await params

    const body = await request.json()
    const parsed = linkSlackContextBodySchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const context = await ideaSlackContextService.linkSlackPermalink({
      ideaRef: id,
      workspaceId: identity.workspaceId,
      permalink: parsed.data.permalink,
      actorMemberId: identity.memberId,
    })
    return NextResponse.json({ context }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'POST /api/ideas/[id]/slack-contexts')
  }
}
