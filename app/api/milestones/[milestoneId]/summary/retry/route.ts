import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneSummaryService } from '@/lib/services/milestone-summary.service'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'

type Params = { params: Promise<{ milestoneId: string }> }

/**
 * POST /api/milestones/[milestoneId]/summary/retry
 * Re-trigger retro generation for a COMPLETED milestone whose last generation
 * failed (or never ran). Creates a fresh pending GenerationJob then fires
 * generate() asynchronously so the HTTP response is immediate (202 Accepted).
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    // Access check (throws 404 if missing, 403 if no project access).
    const milestone = await milestoneService.getMilestone(
      milestoneId,
      identity.memberId
    )

    if (milestone.completedAt === null) {
      return NextResponse.json(
        { error: 'Milestone must be completed to retry retro generation' },
        { status: 400 }
      )
    }

    // Guard: don't enqueue if a job is already pending.
    const alreadyPending =
      await generationJobRepository.findPendingMilestoneJob(milestoneId)
    if (alreadyPending) {
      return NextResponse.json(
        { error: 'Retro generation is already in progress' },
        { status: 409 }
      )
    }

    // Create a fresh pending job so generate() has a record to update.
    await generationJobRepository.createMilestonePending(milestoneId)

    // Fire-and-forget — generate picks up the pending job and updates it.
    milestoneSummaryService.generate(milestoneId).catch(err => {
      void err
    })

    return NextResponse.json({ status: 'queued' }, { status: 202 })
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
