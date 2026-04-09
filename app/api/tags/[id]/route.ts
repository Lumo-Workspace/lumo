import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { updateTagSchema } from '@/lib/validation/schemas'
import { tagService } from '@/lib/services'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/tags/[id] — Update a tag (rename/recolor).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params
  const body = await request.json()
  const parsed = updateTagSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const tag = await tagService.updateTag(id, ws.workspaceId, parsed.data)
    return NextResponse.json({ tag })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    throw error
  }
}

/**
 * DELETE /api/tags/[id] — Delete a tag (cascades associations).
 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const { id } = await params

  try {
    await tagService.deleteTag(id, ws.workspaceId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    throw error
  }
}
