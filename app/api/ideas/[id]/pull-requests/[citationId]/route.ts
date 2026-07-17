import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { ideaPullRequestService } from '@/lib/services/idea-pull-request.service'

type Params = { params: Promise<{ id: string; citationId: string }> }

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

/** Drop a PR citation. Deletes only the citation row — the PullRequest itself
 * belongs to the workspace's sync pipeline and outlives any idea that cited it. */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id, citationId } = await params
    await ideaPullRequestService.unlink({
      workspaceId: identity.workspaceId,
      ideaRef: id,
      citationId,
    })
    return new Response(null, { status: 204 })
  } catch (error) {
    return errorResponse(
      error,
      'DELETE /api/ideas/[id]/pull-requests/[citationId]'
    )
  }
}
