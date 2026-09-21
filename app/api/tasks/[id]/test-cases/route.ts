import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { taskTestCaseService } from '@/lib/services/task-test-case.service'
import { createTestCaseBodySchema } from '@/lib/validation/test-case'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string }> }

function errorResponse(error: unknown): NextResponse {
  const maybe = (error as { status?: unknown } | null)?.status
  const status = typeof maybe === 'number' ? maybe : 500
  const message =
    status === 500 || !(error instanceof Error)
      ? 'Internal error'
      : error.message
  return NextResponse.json({ error: message }, { status })
}

/** GET /api/tasks/[id]/test-cases — the task's test cases + each one's latest run. */
export async function GET(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  return NextResponse.json(await taskTestCaseService.listForTask(task.id))
}

/** POST /api/tasks/[id]/test-cases — add a test case. */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = createTestCaseBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    return NextResponse.json(
      await taskTestCaseService.create(task.id, parsed.data, {
        actorMemberId: identity.memberId,
        sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
      })
    )
  } catch (error) {
    return errorResponse(error)
  }
}
