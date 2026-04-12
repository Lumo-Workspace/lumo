import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { summaryService } from '@/lib/services/summary.service'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import {
  aggregateProjectStats,
  aggregateWorkspaceStats,
  type ProjectRiskOverride,
} from '@/lib/summaries/stats'
import {
  generateProjectReport,
  generateWorkspaceReport,
} from '@/lib/summaries/report'
import { resolveEffectiveRiskConfig } from '@/lib/summaries/risk'

/**
 * GET /api/summaries/generate
 * Called daily by Vercel Cron. Iterates summary-enabled workspaces and
 * generates project + workspace summaries for any that are due based on
 * their configured frequency.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const workspaces = await summaryService.findSummaryEnabledWorkspaces()

    const results = []

    for (const workspace of workspaces) {
      const lastGenerated = workspace.summaries[0]?.generatedAt ?? null

      if (
        !summaryService.isDueForGeneration(
          workspace.summaryFrequency,
          lastGenerated
        )
      ) {
        results.push({ workspaceId: workspace.id, skipped: true })
        continue
      }

      const workspaceConfig = {
        riskOverdueRatio: workspace.riskOverdueRatio,
        riskStalledDays: workspace.riskStalledDays,
        riskStalledMinCount: workspace.riskStalledMinCount,
        riskAgentFailRatio: workspace.riskAgentFailRatio,
        riskStalePrDays: workspace.riskStalePrDays,
        riskThroughputDrop: workspace.riskThroughputDrop,
      }

      const projectSummaries = []
      const projectOverrides = new Map<string, ProjectRiskOverride | null>()

      for (const project of workspace.projects) {
        // Skip if recently generated (manually or by prior cron run)
        const recentJob = await generationJobRepository.findRecentByTarget(
          project.id,
          5
        )
        if (recentJob?.status === 'completed') {
          projectSummaries.push({
            projectId: project.id,
            skipped: true,
          })
          continue
        }

        const override: ProjectRiskOverride = {
          riskOverdueRatio: project.riskOverdueRatio,
          riskStalledDays: project.riskStalledDays,
          riskStalledMinCount: project.riskStalledMinCount,
          riskAgentFailRatio: project.riskAgentFailRatio,
          riskStalePrDays: project.riskStalePrDays,
          riskThroughputDrop: project.riskThroughputDrop,
        }
        projectOverrides.set(project.id, override)

        const effective = resolveEffectiveRiskConfig(workspaceConfig, override)

        try {
          const stats = await aggregateProjectStats(project.id, effective)
          const { tldr, report } = await generateProjectReport(stats, {
            projectName: project.name,
            projectDescription: project.description ?? null,
            locale: workspace.summaryLocale,
          })

          const summary = await summaryService.createProjectSummary(
            project.id,
            stats as unknown as Prisma.InputJsonValue,
            tldr,
            report
          )

          projectSummaries.push({
            projectId: project.id,
            summaryId: summary.id,
          })
          await generationJobRepository
            .create('project', project.id)
            .then(job =>
              generationJobRepository.updateStatus(
                job.id,
                'completed',
                summary.id
              )
            )
        } catch (err) {
          console.error(
            `GET /api/summaries/generate project error [${project.id}]:`,
            err
          )
          projectSummaries.push({ projectId: project.id, error: true })
        }
      }

      const workspaceEffective = resolveEffectiveRiskConfig(
        workspaceConfig,
        null
      )
      const workspaceStats = await aggregateWorkspaceStats(
        workspace.id,
        workspaceEffective,
        projectOverrides
      )
      const { tldr, report } = await generateWorkspaceReport(workspaceStats, {
        workspaceName: workspace.name,
        locale: workspace.summaryLocale,
      })

      const workspaceSummary = await summaryService.createWorkspaceSummary(
        workspace.id,
        workspaceStats as unknown as Prisma.InputJsonValue,
        tldr,
        report
      )
      await generationJobRepository
        .create('workspace', workspace.id)
        .then(job =>
          generationJobRepository.updateStatus(
            job.id,
            'completed',
            workspaceSummary.id
          )
        )

      results.push({
        workspaceId: workspace.id,
        workspaceSummaryId: workspaceSummary.id,
        projects: projectSummaries,
      })
    }

    // Clean up old generation jobs (older than 7 days)
    await generationJobRepository.deleteOlderThan(7)

    return NextResponse.json({ results })
  } catch (error) {
    console.error('GET /api/summaries/generate error:', error)
    return NextResponse.json(
      { error: 'Failed to generate summaries' },
      { status: 500 }
    )
  }
}
