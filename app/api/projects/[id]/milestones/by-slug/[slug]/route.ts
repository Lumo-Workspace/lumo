import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { loadProjectForIdentity } from '@/lib/api/helpers'
import { milestoneService } from '@/lib/services/milestone.service'
import { milestoneRollupService } from '@/lib/services/milestone-rollup.service'
import { milestoneRepository } from '@/lib/repositories/milestone.repository'
import { milestoneSummaryRepository } from '@/lib/repositories/milestone-summary.repository'
import { milestoneHealthFromCounts } from '@/lib/summaries/milestone-health'

interface Params {
  params: Promise<{ id: string; slug: string }>
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const identity = await requireIdentity(request)
    if (identity instanceof NextResponse) return identity
    const { id, slug } = await params

    const result = await loadProjectForIdentity(id, identity)
    if (result instanceof NextResponse) return result
    const { project, member } = result

    const milestone = await milestoneService.getMilestoneBySlug(
      id,
      slug,
      member.id
    )
    // Enrich the same way as GET /api/milestones/[milestoneId] — the detail
    // page resolves canonical slug URLs through this route, so the Overview
    // rollup needs the same taskCounts/health/coverage/tldr payload here.
    const taskCounts = await milestoneRepository.countTasksByStatus(
      milestone.id
    )
    const health = milestoneHealthFromCounts(milestone, taskCounts, new Date())
    // LUM-624 staleness hints + self-heal apply on this read path too — the
    // detail page resolves canonical slug URLs here, not via by-id.
    const staleness = await milestoneRollupService.observeOnRead(
      milestone,
      taskCounts
    )
    // outcome rides this path too (LUM-626 shipped it on by-id only — the
    // canonical slug URL was missing it), plus the LUM-627 cost+trend rollup.
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
    ] = await Promise.all([
      milestoneService.getSprintCoverageForTeam(milestone.id, project.teamId),
      milestoneService.getOutcomeForMilestone(milestone.id),
      milestoneSummaryRepository.findByMilestoneId(milestone.id),
      milestoneService.getCostTrendForMilestone(
        milestone.id,
        project.teamId,
        milestone.tokenBudget
      ),
      milestoneService.getSegmentsForMilestone(milestone.id, project.teamId),
      milestoneService.getDeliveryStatsForMilestone(milestone.id),
      milestoneService.getMemberDeliveryForMilestone(milestone.id),
      milestoneService.getRiskQueueForMilestone(milestone.id),
      milestoneService.getTopologyForMilestone(milestone.id),
      milestoneService.getWeightedProgressForMilestone(milestone.id),
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
