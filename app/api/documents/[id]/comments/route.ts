import { waitUntil } from '@/lib/runtime/wait-until'
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { createDocumentCommentSchema } from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { getHumanActorId } from '@/lib/actor'
import { documentCommentService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

function errorResponse(error: unknown) {
  if (error instanceof Error && 'status' in error) {
    return NextResponse.json(
      { error: error.message },
      { status: (error as Error & { status: number }).status }
    )
  }
  console.error('[doc-comments] unexpected error:', error)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

/**
 * GET /api/documents/[id]/comments
 * Returns comment threads for the document, nested by parentId.
 *
 * Accepts Clerk sessions and bearer tokens.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params
    const comments = await documentCommentService.getComments(
      id,
      identity.memberId,
      identity.workspaceId
    )
    return NextResponse.json({ comments })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * POST /api/documents/[id]/comments
 * Creates an anchored comment thread or a reply to an existing thread.
 *
 * Accepts Clerk sessions and bearer tokens.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id } = await params

    const body = await request.json()
    const parsed = createDocumentCommentSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const authorActorId = await getHumanActorId(identity.memberId)
    if (!authorActorId) {
      return NextResponse.json({ error: 'Actor not found' }, { status: 500 })
    }

    const comment = await documentCommentService.createCommentWithSideEffects({
      documentId: id,
      memberId: identity.memberId,
      workspaceId: identity.workspaceId,
      authorActorId,
      input: parsed.data,
      waitUntil,
    })
    return NextResponse.json({ comment }, { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
