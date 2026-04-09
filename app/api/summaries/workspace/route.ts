import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { memberRepository } from '@/lib/repositories/member.repository'
import { summaryService } from '@/lib/services/summary.service'
import { getSummarySchema } from '@/lib/validation/schemas'

export async function GET(request: Request) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult

    const member = await memberRepository.findFirstByClerkId(userId)

    if (!member) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

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
      member.workspaceId,
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
