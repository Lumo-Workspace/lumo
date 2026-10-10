import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, requireWorkspaceMember } from '@/lib/auth'
import { taskService } from '@/lib/services'
import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/security-scans — the latest security scan per linked PR
 * plus the DONE-blocking count (LUM-732). Read-only. task not found → 404.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const authResult = await requireAuth()
    if (authResult instanceof NextResponse) return authResult
    const { userId } = authResult
    const { id } = await params

    const taskDetail = await taskService.getTaskDetail(id)
    if (!taskDetail) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const memberResult = await requireWorkspaceMember(
      taskDetail.project.workspaceId,
      userId
    )
    if (memberResult instanceof NextResponse) return memberResult

    const view = await prSecurityScanService.getForTask(id)
    return NextResponse.json(view)
  } catch {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
