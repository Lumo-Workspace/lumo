import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { waitUntil } from '@/lib/runtime/wait-until'
import { requireAuth } from '@/lib/auth'
import { requireUserWorkspace } from '@/lib/api/helpers'
import { summaryService } from '@/lib/services/summary.service'
import { getWorkspaceStats } from '@/lib/services/stats.service'
import { generateWorkspaceReport } from '@/lib/summaries/report'
import { generationJobRepository } from '@/lib/repositories/generation-job.repository'

export async function POST(_req: NextRequest) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult
  const { userId } = authResult

  const wsResult = await requireUserWorkspace(userId)
  if (wsResult instanceof NextResponse) return wsResult

  const workspaceId = wsResult.workspace.id

  const genResult = await summaryService.requestGeneration(
    'workspace',
    workspaceId
  )
  if ('retryAfter' in genResult) {
    return NextResponse.json(
      { error: 'Too many requests', retryAfter: genResult.retryAfter },
      { status: 429 }
    )
  }

  const { jobId } = genResult

  waitUntil(
    (async () => {
      try {
        const stats = await getWorkspaceStats(workspaceId)
        const { tldr, report } = await generateWorkspaceReport(stats, {
          workspaceName: wsResult.workspace.name,
          locale: wsResult.workspace.summaryLocale ?? 'en',
        })
        const summary = await summaryService.createWorkspaceSummary(
          workspaceId,
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
        console.error('POST /api/summaries/generate/workspace error:', err)
        await generationJobRepository.updateStatus(jobId, 'failed')
      }
    })()
  )

  return NextResponse.json({ jobId }, { status: 202 })
}
