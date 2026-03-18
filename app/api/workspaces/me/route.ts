import { NextResponse } from 'next/server'
import { requireAuth, getUserWorkspace } from '@/lib/auth'

/**
 * GET /api/workspaces/me — Get the current user's workspace.
 */
export async function GET() {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const result = await getUserWorkspace(userId)
    if (!result) {
      return NextResponse.json(
        { error: 'No workspace found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      workspace: result.workspace,
      role: result.member.role,
    })
  } catch (error) {
    console.error('GET /api/workspaces/me error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
