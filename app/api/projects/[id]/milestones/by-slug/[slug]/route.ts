import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { milestoneService } from '@/lib/services/milestone.service'
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

    const result = await loadProjectAndMember(id, identity.clerkId)
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
    const sprintCoverage = await milestoneService.getSprintCoverageForTeam(
      milestone.id,
      project.teamId
    )
    const summary = await milestoneSummaryRepository.findByMilestoneId(
      milestone.id
    )
    return NextResponse.json({
      milestone: {
        ...milestone,
        taskCounts,
        health,
        sprintCoverage,
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
