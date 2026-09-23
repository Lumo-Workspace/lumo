import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { createTagSchema } from '@/lib/validation/schemas'
import { tagService } from '@/lib/services'

/**
 * GET /api/tags — List all tags in the current workspace.
 * Browser session or CLI bearer (LUM-821: `lumo tag list`, `task search --tag`).
 */
export async function GET(request: NextRequest) {
  const ws = await requireIdentity(request)
  if (ws instanceof NextResponse) return ws

  const raw = await tagService.listTags(ws.workspaceId)
  const tags = raw.map(t => ({
    id: t.id,
    name: t.name,
    color: t.color,
    workspaceId: t.workspaceId,
    createdAt: t.createdAt,
    taskCount: t._count.taskTags,
    documentCount: t._count.documentTags,
  }))
  return NextResponse.json({ tags })
}

/**
 * POST /api/tags — Create a tag in the current workspace.
 */
export async function POST(request: NextRequest) {
  const ws = await requireIdentity(request)
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
