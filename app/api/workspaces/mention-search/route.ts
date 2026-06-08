import { NextResponse, type NextRequest } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { mentionSearchService } from '@/lib/services/mention-search.service'

const DEFAULT_PER_KIND = 5
const MAX_PER_KIND = 10

export async function GET(request: NextRequest) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { workspaceId, workspaceSlug } = identity

    const url = new URL(request.url)
    const q = url.searchParams.get('q') ?? ''
    const limitRaw = Number(url.searchParams.get('limit') ?? DEFAULT_PER_KIND)
    const perKind = Number.isFinite(limitRaw)
      ? Math.min(Math.max(1, Math.trunc(limitRaw)), MAX_PER_KIND)
      : DEFAULT_PER_KIND

    const items = await mentionSearchService.search(
      workspaceId,
      workspaceSlug,
      q,
      perKind
    )
    return NextResponse.json({ items })
  } catch (error) {
    console.error('GET /api/workspaces/mention-search error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
