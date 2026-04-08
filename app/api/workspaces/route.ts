import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { createWorkspaceSchema } from '@/lib/validation/schemas'
import { workspaceService } from '@/lib/services'

/**
 * POST /api/workspaces — Create a workspace and become owner.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const body = await request.json()
    const parsed = createWorkspaceSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const result = await workspaceService.createWorkspace(userId, parsed.data)

    return NextResponse.json(
      { workspace: result.workspace, member: result.member },
      { status: 201 }
    )
  } catch (error) {
    if (error instanceof Error && 'status' in error) {
      return NextResponse.json(
        { error: error.message },
        { status: (error as Error & { status: number }).status }
      )
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
