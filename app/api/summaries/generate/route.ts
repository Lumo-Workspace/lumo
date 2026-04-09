import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { summaryService } from '@/lib/services/summary.service'
import { generateSummarySchema } from '@/lib/validation/schemas'
import {
  aggregateProjectStats,
  aggregateWorkspaceStats,
} from '@/lib/summaries/stats'
import {
  generateProjectReport,
  generateWorkspaceReport,
} from '@/lib/summaries/report'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const parsed = generateSummarySchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      )
    }

    const { workspaceId, secret } = parsed.data

    if (secret !== process.env.SUMMARY_CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaces =
      await summaryService.findSummaryEnabledWorkspaces(workspaceId)

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
            `POST /api/summaries/generate project error [${project.id}]:`,
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
    console.error('POST /api/summaries/generate error:', error)
    return NextResponse.json(
      { error: 'Failed to generate summaries' },
      { status: 500 }
    )
  }
}
