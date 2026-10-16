import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { zodError } from '@/lib/api/helpers'
import { logger } from '@/lib/logger'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { prSecurityScanService } from '@/ee/security/services/pr-security-scan.service'
import { prScanReadoutService } from '@/ee/security/services/pr-scan-readout.service'
import { taskSecurityScansQuerySchema } from '@/ee/security/validation/security-scan'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/tasks/[id]/security-scans — the task's security scans, one entry
 * per linked PR. Read-only. The path is fixed: published clients call it.
 *
 * LUM-1189: Clerk sessions and API-key bearers alike; the task resolves
 * inside the caller's workspace only (`LUM-N` or cuid) — another
 * workspace's task is a 404. Two shapes:
 * - the panel read model (LUM-732) — the default for a browser session, so
 *   the web is unchanged. It carries finding `evidence` and raw scanner text
 *   that the browser escapes on render.
 * - the read-out (`?view=readout`, and always for a bearer caller) — each PR
 *   as the same `PullRequestScanReadout` `lumo pr scan` prints: free text
 *   sanitized and secret-redacted on the server, `evidence` never loaded.
 *   An agent's terminal only ever gets this one.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { searchParams } = new URL(request.url)
  const query = taskSecurityScansQuerySchema.safeParse({
    view: searchParams.get('view') ?? undefined,
    all: searchParams.get('all') ?? undefined,
  })
  if (!query.success) return zodError(query)

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  try {
    if (query.data.view === 'readout' || identity.source !== 'clerk') {
      const readout = await prScanReadoutService.getForTask(
        identity.workspaceId,
        { id: task.id, identifier: `${task.team.identifier}-${task.number}` },
        { all: query.data.all }
      )
      return NextResponse.json(readout)
    }
    const view = await prSecurityScanService.getForTask(task.id)
    return NextResponse.json(view)
  } catch (error) {
    logger.error('taskSecurityScans.read.failed', {
      workspaceId: identity.workspaceId,
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
