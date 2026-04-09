import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { createTagSchema } from '@/lib/validation/schemas'
import { tagService } from '@/lib/services'

/**
 * GET /api/tags — List all tags in the current workspace.
 */
export async function GET(_request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const tags = await tagService.listTags(ws.workspaceId)
  return NextResponse.json({ tags })
}

/**
 * POST /api/tags — Create a tag in the current workspace.
 */
export async function POST(request: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const ws = await requireUserWorkspace(userId)
  if (ws instanceof NextResponse) return ws

  const body = await request.json()
  const parsed = createTagSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const tag = await tagService.createTag(ws.workspaceId, parsed.data)
    return NextResponse.json({ tag }, { status: 201 })
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
