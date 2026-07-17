import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { ideaPullRequestService } from '@/lib/services/idea-pull-request.service'
import { linkIdeaPullRequestBodySchema } from '@/lib/validation/idea-evidence'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'
// The URL path may hit api.github.com for a PR we don't track yet.
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
    const pullRequests = await ideaPullRequestService.list({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })
    return NextResponse.json({ pullRequests })
  } catch (error) {
    return errorResponse(error, 'GET /api/ideas/[id]/pull-requests')
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { id } = await params

    const body = await request.json().catch(() => null)
    const parsed = linkIdeaPullRequestBodySchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const citation = await ideaPullRequestService.link({
      workspaceId: identity.workspaceId,
      ideaRef: id,
      createdById: identity.memberId,
      ...(parsed.data.prId !== undefined ? { prId: parsed.data.prId } : {}),
      ...(parsed.data.url !== undefined ? { url: parsed.data.url } : {}),
    })
    return NextResponse.json({ citation }, { status: 201 })
  } catch (error) {
    return errorResponse(error, 'POST /api/ideas/[id]/pull-requests')
  }
}
