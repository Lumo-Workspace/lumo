import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneSummaryRepository } from '@/lib/repositories/milestone-summary.repository'

type Params = { params: Promise<{ milestoneId: string }> }

/**
 * GET /api/milestones/[milestoneId]/summary — Fetch the generated retro summary.
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function GET(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    // Access check (throws 404 if missing, 403 if no project access).
    await milestoneService.getMilestone(milestoneId, identity.memberId)

    const summary =
      await milestoneSummaryRepository.findByMilestoneId(milestoneId)
    if (!summary)
      return NextResponse.json(
        { error: 'Retro not generated yet' },
        { status: 404 }
      )

    return NextResponse.json(summary)
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
