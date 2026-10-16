import { NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth/identity'
import { loadProjectForIdentity } from '@/lib/api/helpers'
import { summaryService } from '@/lib/services/summary.service'
import { getSummarySchema } from '@/lib/validation/schemas'

/**
 * GET /api/summaries/project/[projectId] — stored project summaries, newest
 * first. Read-only: generation is `POST /api/summaries/generate/project/[id]`.
 *
 * LUM-1192: browser session or API key (`lumo project overview`). A project
 * outside the credential's workspace answers 404, like a missing one.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity

    const { projectId } = await params

    const projectResult = await loadProjectForIdentity(projectId, identity)
    if (projectResult instanceof NextResponse) return projectResult

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

    const summaries = await summaryService.getProjectSummaries(projectId, {
      limit,
      before,
    })

    return NextResponse.json({ summaries })
  } catch (error) {
    console.error('GET /api/summaries/project/[projectId] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch project summaries' },
      { status: 500 }
    )
  }
}
