import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { summaryService } from '@/lib/services/summary.service'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const authResult = await requireAuth()
  if (authResult instanceof NextResponse) return authResult

  const { jobId } = await params

  const result = await summaryService.getJobStatus(jobId)
  if (!result) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }

  return NextResponse.json(result)
}
