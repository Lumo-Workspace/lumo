import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace, zodError } from '@/lib/api/helpers'
import { searchPullRequestsSchema } from '@/lib/validation/schemas'
import { pullRequestRepository } from '@/lib/repositories/pull-request.repository'

/**
 * GET /api/pull-requests/search?q=...&workspaceId=...&limit=20
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const { searchParams } = new URL(request.url)
    const parsed = searchPullRequestsSchema.safeParse({
      q: searchParams.get('q'),
      workspaceId: searchParams.get('workspaceId'),
      limit: searchParams.get('limit'),
    })
    if (!parsed.success) return zodError(parsed)

    const ws = await requireUserWorkspace(userId)
    if (ws instanceof NextResponse) return ws
    if (ws.workspace.id !== parsed.data.workspaceId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const results = await pullRequestRepository.searchByWorkspace(
      parsed.data.workspaceId,
      parsed.data.q,
      parsed.data.limit
    )

    return NextResponse.json({ pullRequests: results })
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
