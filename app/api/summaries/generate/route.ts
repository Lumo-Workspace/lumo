import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { summaryService } from '@/lib/services/summary.service'
import {
  aggregateProjectStats,
  aggregateWorkspaceStats,
} from '@/lib/summaries/stats'
import {
  generateProjectReport,
  generateWorkspaceReport,
} from '@/lib/summaries/report'

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

      const projectSummaries = []

      for (const project of workspace.projects) {
        try {
          const stats = await aggregateProjectStats(project.id)
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
        } catch (err) {
          console.error(
            `GET /api/summaries/generate project error [${project.id}]:`,
            err
          )
          projectSummaries.push({ projectId: project.id, error: true })
        }
      }

      const workspaceStats = await aggregateWorkspaceStats(workspace.id)
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

      results.push({
        workspaceId: workspace.id,
        workspaceSummaryId: workspaceSummary.id,
        projects: projectSummaries,
      })
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('GET /api/summaries/generate error:', error)
    return NextResponse.json(
      { error: 'Failed to generate summaries' },
      { status: 500 }
    )
  }
}
