import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { sprintRepository } from '@/lib/repositories'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import { requireTeamMemberOrOwner } from '@/lib/auth/require-team-access'
import { sprintSummaryService } from '@/lib/services/sprint-summary.service'

type Params = { params: Promise<{ sprintId: string }> }

/**
 * POST /api/sprints/[sprintId]/summary/retry
 * Re-trigger retro generation for a CLOSED sprint whose last generation failed
 * (or never ran). Creates a fresh pending GenerationJob then fires generate()
 * asynchronously so the HTTP response is immediate (202 Accepted).
 *
 * Accepts both Clerk sessions (browser) and bearer tokens (CLI).
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(req)
    if (identity instanceof NextResponse) return identity
    const { sprintId } = await params

    const sprint = await sprintRepository.findById(sprintId)
    if (!sprint)
      return NextResponse.json({ error: 'Sprint not found' }, { status: 404 })

    await requireTeamMemberOrOwner(
      identity,
      { workspaceId: sprint.team.workspaceId, teamId: sprint.teamId },
      'Sprint not found'
    )

    if (sprint.status !== 'CLOSED') {
      return NextResponse.json(
        { error: 'Sprint must be CLOSED to retry retro generation' },
        { status: 400 }
      )
    }

    // Guard: don't enqueue if a job is already pending.
    const alreadyPending =
      await generationJobRepository.findPendingSprintJob(sprintId)
    if (alreadyPending) {
      return NextResponse.json(
        { error: 'Retro generation is already in progress' },
        { status: 409 }
      )
    }

    // Create a fresh pending job so generate() has a record to update.
    await generationJobRepository.createSprintPending(sprintId)

    // Fire-and-forget — generate picks up the pending job and updates it.
    sprintSummaryService.generate(sprintId).catch(err => {
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
