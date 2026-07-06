import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { ideaActivityService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/ideas/[id]/activity — the idea's activity timeline, oldest first.
 * `[id]` is a cuid id (web) or a `<TEAM>-I<n>` identifier / bare number. Scoped
 * to the caller's default team; a foreign/missing id is a uniform 404.
 */
export async function GET(request: Request, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const { id } = await params

  try {
    const activity = await ideaActivityService.listForIdea({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })
    return NextResponse.json({ activity })
  } catch (err) {
    const errStatus = (err as { status?: unknown })?.status
    const status = typeof errStatus === 'number' ? errStatus : 500
    if (status === 500) {
      console.error('GET /api/ideas/[id]/activity error:', err)
      return NextResponse.json(
        { error: 'Internal Server Error' },
        { status: 500 }
      )
    }
    const message = err instanceof Error ? err.message : 'Error'
    return NextResponse.json({ error: message }, { status })
  }
}
