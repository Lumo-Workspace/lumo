import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveIdeaRef } from '@/lib/services/idea-evidence-resolve'
import { ideaSlackContextService } from '@/lib/services/idea-slack-context.service'

type Params = { params: Promise<{ id: string; contextId: string }> }

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

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id, contextId } = await params
    await resolveIdeaRef({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })

    await ideaSlackContextService.unlinkContext(contextId, identity.workspaceId)
    return new Response(null, { status: 204 })
  } catch (error) {
    return errorResponse(
      error,
      'DELETE /api/ideas/[id]/slack-contexts/[contextId]'
    )
  }
}
