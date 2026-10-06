import { waitUntil } from '@/lib/runtime/wait-until'
import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import {
  updateDocumentCommentSchema,
  resolveDocumentCommentSchema,
} from '@/lib/validation/schemas'
import { zodError } from '@/lib/api/helpers'
import { getHumanActorId } from '@/lib/actor'
import { documentCommentService } from '@/lib/services'

type Params = { params: Promise<{ id: string; commentId: string }> }

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
 * PATCH /api/documents/[id]/comments/[commentId]
 * If body contains `status`, resolves/re-opens the comment thread.
 * Otherwise, updates the comment body text.
 *
 * Accepts Clerk sessions and bearer tokens.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { commentId } = await params
    const body = await request.json()

    if (body && typeof body === 'object' && 'status' in body) {
      const parsed = resolveDocumentCommentSchema.safeParse(body)
      if (!parsed.success) return zodError(parsed)
      const actorId = await getHumanActorId(identity.memberId)
      const comment = await documentCommentService.setStatusWithSideEffects({
        commentId,
        status: parsed.data.status,
        memberId: identity.memberId,
        workspaceId: identity.workspaceId,
        actorId,
        waitUntil,
      })
      return NextResponse.json({ comment })
    }

    const parsed = updateDocumentCommentSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)
    const actorId = await getHumanActorId(identity.memberId)
    const comment = await documentCommentService.updateCommentWithSideEffects({
      commentId,
      memberId: identity.memberId,
      workspaceId: identity.workspaceId,
      actorId,
      body: parsed.data.body,
      waitUntil,
    })
    return NextResponse.json({ comment })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * DELETE /api/documents/[id]/comments/[commentId]
 * Soft-deletes the comment. Strips the anchor mark from doc content
 * if this is a top-level thread.
 *
 * Accepts Clerk sessions and bearer tokens.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { commentId } = await params
    const actorId = await getHumanActorId(identity.memberId)
    await documentCommentService.deleteCommentWithSideEffects({
      commentId,
      memberId: identity.memberId,
      workspaceId: identity.workspaceId,
      actorId,
      waitUntil,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
