import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { updateMilestoneSchema } from '@/lib/validation/schemas'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneSummaryRepository } from '@/lib/repositories/milestone-summary.repository'
import { milestoneHealthFromCounts } from '@/lib/summaries/milestone-health'

interface Params {
  params: Promise<{ milestoneId: string }>
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const { milestone, teamId } = await milestoneService.getMilestoneWithTeam(
      milestoneId,
      identity.memberId
    )
    const taskCounts = await milestoneRepository.countTasksByStatus(milestoneId)
    const health = milestoneHealthFromCounts(milestone, taskCounts, new Date())
    // LUM-624: staleness hints for the payload; a detected status drift also
    // dispatches a background reconcile so stale rows self-heal on read.
    const staleness = milestoneRollupService.observeOnRead(
      milestone,
      taskCounts
    )
    const [sprintCoverage, outcome, summary] = await Promise.all([
      milestoneService.getSprintCoverageForTeam(milestoneId, teamId),
      milestoneService.getOutcomeForMilestone(milestoneId),
      milestoneSummaryRepository.findByMilestoneId(milestoneId),
    ])
    return NextResponse.json({
      milestone: {
        ...milestone,
        taskCounts,
        health,
        staleness,
        sprintCoverage,
        outcome,
        summaryTldr: summary?.tldr ?? null,
      },
    })
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

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    const body = await request.json()
    const parsed = updateMilestoneSchema.safeParse(body)
    if (!parsed.success) return zodError(parsed)

    const milestone = await milestoneService.updateMilestone(
      milestoneId,
      identity.memberId,
      parsed.data
    )
    return NextResponse.json({ milestone })
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

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { milestoneId } = await params

    await milestoneService.deleteMilestone(milestoneId, identity.memberId)
    return NextResponse.json({ ok: true })
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
