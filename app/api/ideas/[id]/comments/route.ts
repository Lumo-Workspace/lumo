import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { getHumanActorId } from '@/lib/actor'
import { createCommentSchema } from '@/lib/validation/schemas'
import { ideaCommentService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/ideas/[id]/comments — the idea's flat comment thread, oldest first.
 * `[id]` is a cuid id (web) or a `<TEAM>-I<n>` identifier / bare number (CLI).
 * Scoped to the caller's default team; a foreign/missing id is a uniform 404.
 */
export async function GET(request: Request, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const { id } = await params

  try {
    const comments = await ideaCommentService.listComments({
      workspaceId: identity.workspaceId,
      ideaRef: id,
    })
    return NextResponse.json({ comments })
  } catch (err) {
    return errorResponse(err, 'GET /api/ideas/[id]/comments')
  }
}

/**
 * POST /api/ideas/[id]/comments — post a comment on an idea. Body: `{ body }`
 * (the shared comment schema; parentId/quotedCommentId are ignored — idea
 * threads are flat). Records a COMMENT_ADDED activity. Auth via Clerk (web) or
 * Bearer (CLI — `lumo idea comment`).
 */
export async function POST(request: Request, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = createCommentSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  const authorActorId = await getHumanActorId(identity.memberId)
  if (!authorActorId) {
    return NextResponse.json({ error: 'Actor not found' }, { status: 500 })
  }

  try {
    const comment = await ideaCommentService.createComment({
      workspaceId: identity.workspaceId,
      ideaRef: id,
      authorActorId,
      body: parsed.data.body,
    })
    return NextResponse.json({ comment }, { status: 201 })
  } catch (err) {
    return errorResponse(err, 'POST /api/ideas/[id]/comments')
  }
}

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
