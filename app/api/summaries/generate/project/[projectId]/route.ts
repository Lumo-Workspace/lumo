import { NextRequest, NextResponse } from 'next/server'
import { type Prisma } from '@prisma/client'
import { waitUntil } from '@/lib/runtime/wait-until'
import { requireAuth } from '@/lib/auth'
import { loadProjectAndMember } from '@/lib/api/helpers'
import { summaryService } from '@/lib/services/summary.service'
import { getProjectStats } from '@/lib/services/stats.service'
import { generateProjectReport } from '@/lib/summaries/report'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'
import { statsRepository } from '@/lib/repositories/stats.repository'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const { projectId } = await params

  const result = await loadProjectAndMember(projectId, userId)
  if (result instanceof NextResponse) return result
  const { project } = result

  const genResult = await summaryService.requestGeneration('project', projectId)
  if ('retryAfter' in genResult) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: genResult.retryAfter },
      { status: 429 }
    )
  }

  const { jobId } = genResult

  const workspace = await statsRepository.findWorkspaceSummaryLocale(
    project.workspaceId
  )

  const projectRecord =
    await statsRepository.findProjectNameAndDescription(projectId)

  waitUntil(
    (async () => {
      try {
        const stats = await getProjectStats(projectId, project.workspaceId)
        const { tldr, report } = await generateProjectReport(stats, {
          projectName: projectRecord?.name ?? 'Unknown',
          projectDescription: projectRecord?.description ?? null,
          locale: workspace?.summaryLocale ?? 'en',
        })
        const summary = await summaryService.createProjectSummary(
          projectId,
          stats as unknown as Prisma.InputJsonValue,
          tldr,
          report
        )
        await generationJobRepository.updateStatus(
          jobId,
          'completed',
          summary.id
        )
      } catch (err) {
        console.error(
          `POST /api/summaries/generate/project/${projectId} error:`,
          err
        )
        await generationJobRepository.updateStatus(jobId, 'failed')
      }
    })()
  )

  return NextResponse.json({ jobId }, { status: 202 })
}
