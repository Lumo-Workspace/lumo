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
import {
  aiFeaturesService,
  aiFeatureUnavailableError,
} from '@/lib/services/ai-features.service'

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

  // LUM-1338: the project report is an AI write-up (the retro summaries switch).
  // 409 AI_FEATURE_OFF when switched off, 503 AI_NOT_CONFIGURED without a model.
  if (!(await aiFeaturesService.isEnabled({ projectId }, 'retroSummary'))) {
    const err = aiFeatureUnavailableError('retroSummary') as Error & {
      status: number
      code: string
    }
    return NextResponse.json(
      { error: err.message, code: err.code },
      { status: err.status }
    )
  }

  const genResult = await summaryService.requestGeneration('project', projectId)
  if ('retryAfter' in genResult) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: genResult.retryAfter },
      { status: 429 }
    )
  }

  const { jobId } = genResult

  const workspace = await statsRepository.findWorkspaceDefaultLocale(
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
          locale: workspace?.defaultLocale ?? 'en',
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
