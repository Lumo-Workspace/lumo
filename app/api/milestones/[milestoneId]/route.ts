import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { updateMilestoneSchema } from '@/lib/validation/schemas'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import { logger } from '@/lib/logger'
import { milestoneCloseGateService } from '@/lib/services/milestone-close-gate.service'
import { milestoneLearningService } from '@/lib/services/milestone-learning.service'
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
    // LUM-624: staleness hints for the payload; a detected completion drift
    // also dispatches a background reconcile so stale rows self-heal on read.
    const staleness = await milestoneRollupService.observeOnRead(
      milestone,
      taskCounts
    )
    const [
      sprintCoverage,
      outcome,
      summary,
      costTrend,
      segments,
      deliveryStats,
      memberDelivery,
      riskQueue,
      topology,
      weightedProgress,
      crossMilestoneLearning,
      closeGate,
    ] = await Promise.all([
      milestoneService.getSprintCoverageForTeam(milestoneId, teamId),
      milestoneService.getOutcomeForMilestone(milestoneId),
      milestoneSummaryRepository.findByMilestoneId(milestoneId),
      milestoneService.getCostTrendForMilestone(
        milestoneId,
        teamId,
        milestone.tokenBudget
      ),
      milestoneService.getSegmentsForMilestone(milestoneId, teamId),
      milestoneService.getDeliveryStatsForMilestone(milestoneId),
      milestoneService.getMemberDeliveryForMilestone(milestoneId),
      milestoneService.getRiskQueueForMilestone(milestoneId),
      milestoneService.getTopologyForMilestone(milestoneId),
      milestoneService.getWeightedProgressForMilestone(milestoneId),
      // LUM-648: cross-milestone learning-migration usage read-out. Fail-soft
      // — a secondary analytics read must never 500 the whole milestone detail;
      // on error it degrades to null (the CLI omits the section).
      milestoneLearningService
        .getCrossMilestoneUsage(milestoneId)
        .catch(err => {
          console.error('cross-milestone learning read failed:', err)
          return null
        }),
      // LUM-1135: close-gate read-out; fail-soft like the other secondary reads.
      milestoneCloseGateService.read(milestoneId).catch(err => {
        logger.error('milestone close gate read failed:', err)
        return null
      }),
    ])
    return NextResponse.json({
      milestone: {
        ...milestone,
        taskCounts,
        health,
        staleness,
        closeGate,
        sprintCoverage,
        outcome,
        summaryTldr: summary?.tldr ?? null,
        costRollup: costTrend.costRollup,
        budget: costTrend.budget,
        burnup: costTrend.burnup,
        derivedStartDate: costTrend.derivedStartDate,
        segments,
        deliveryStats,
        memberDelivery,
        riskQueue,
        topology,
        weightedProgress,
        crossMilestoneLearning,
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
