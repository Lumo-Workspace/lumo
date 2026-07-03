import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneChangelogService } from '@/lib/services/milestone-changelog.service'

type Params = { params: Promise<{ milestoneId: string }> }

/**
 * GET /api/milestones/[milestoneId]/changelog — the LUM-649 automatic
 * changelog: DONE tasks + merged PRs + frozen claimSnapshot, assembled with
 * honest reporting (baseline-annotated headline counts, claim provenance).
 * Pure assembly, no LLM — runs on a milestone of any status.
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

    const changelog = await milestoneChangelogService.assemble(milestoneId)
    return NextResponse.json(changelog)
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
