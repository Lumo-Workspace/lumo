import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { taskWorkflowCatalog } from '@/lib/task/state-machine'

/**
 * GET /api/tasks/statuses
 * The task status set, allowed transitions and priorities (LUM-821). Static
 * per deployment, but served so clients never hardcode the workflow.
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity
  return NextResponse.json(taskWorkflowCatalog())
}
