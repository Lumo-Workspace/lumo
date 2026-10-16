import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { summaryService } from '@/lib/services/summary.service'
import { getSummarySchema } from '@/lib/validation/schemas'

/**
 * GET /api/summaries/workspace — stored workspace briefings, newest first.
 * Read-only: generation is `POST /api/summaries/generate/workspace`.
 *
 * LUM-1192: browser session or API key (`lumo workspace overview`). Scoped to
 * the credential's workspace (a Bearer key's own, or the session's active one).
 */
export async function GET(request: Request) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { searchParams } = new URL(request.url)
    const parsed = getSummarySchema.safeParse({
      limit: searchParams.get('limit') ?? undefined,
      before: searchParams.get('before') ?? undefined,
    })
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { limit, before } = parsed.data

    const summaries = await summaryService.getWorkspaceSummaries(
      identity.workspaceId,
      { limit, before }
    )

    return NextResponse.json({ summaries })
  } catch (error) {
    console.error('GET /api/summaries/workspace error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch workspace summaries' },
      { status: 500 }
    )
  }
}
