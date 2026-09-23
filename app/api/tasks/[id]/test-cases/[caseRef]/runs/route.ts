import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { resolveTestCaseParam } from '@/lib/api/resolve-test-case-param'
import { taskTestCaseService } from '@/lib/services/task-test-case.service'
import { recordRunBodySchema } from '@/lib/validation/test-case'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; caseRef: string }> }

/**
 * POST /api/tasks/[id]/test-cases/[caseRef]/runs — append one execution record.
 *
 * There is deliberately **no** PATCH/DELETE on a run: the log is append-only.
 * Correcting a mis-recorded run means appending another one, not rewriting
 * history. Do not add them.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId, caseRef } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const testCase = await resolveTestCaseParam(task.id, caseRef)
  if (!testCase)
    return NextResponse.json({ error: 'Test case not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = recordRunBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const outcome = await taskTestCaseService.recordRun(testCase, parsed.data, {
      actorMemberId: identity.memberId,
      sourceSessionId: request.headers.get('X-Lumo-Session-Id'),
    })
    // LUM-819 兼容：≤1.69.x 的 CLI 只认 environment / unobserved 两种原因，
    // 其余一律按 unobserved 读 `ceiling.unobserved.map(…)`——没有这个字段会在
    // run 已落库之后崩掉。多带一个空数组让老 CLI 降级成一行不完整的说明，
    // 而不是报错退出。新 CLI 按 reason 分支，不读这个字段。
    const ceiling =
      outcome.ceiling.effective === 'UNPROVEN' &&
      outcome.ceiling.reason === 'no-evidence'
        ? { ...outcome.ceiling, unobserved: [] }
        : outcome.ceiling
    return NextResponse.json({ ...outcome, ceiling })
  } catch (error) {
    const maybe = (error as { status?: unknown } | null)?.status
    const status = typeof maybe === 'number' ? maybe : 500
    const message =
      status === 500 || !(error instanceof Error)
        ? 'Internal error'
        : error.message
    return NextResponse.json({ error: message }, { status })
  }
}
