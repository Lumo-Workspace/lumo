import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { testCaseDefectDispositionService } from '@/lib/services/test-case-defect-disposition.service'
import { memberAuditContext } from '@/lib/api/audit-context'
import { disposeDefectBodySchema } from '@/lib/validation/test-case'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; runId: string }> }

/**
 * POST /api/tasks/[id]/test-case-runs/[runId]/disposition — LUM-812：对一条
 * 「证明了坏」的 run 落人类裁定，第四条 DONE 拦截面的清闸口。
 *
 * ## 与越界那条路的一处**有意分歧**
 *
 * 越界把 CLI 和 web 拆成两条路由，理由是 CLI 那条的 schema 要**更窄**（revert
 * 到 OPEN、仓库级压制都只能 web）。这里两条路能落的裁定完全一样，没有窄可收，
 * 所以合成一条、按 `identity.source` 分流：
 *
 *   - bearer（CLI）→ `channel: 'CLI'`，**必须**出示 `--confirm-read` 换来的
 *     stage-2 回执（服务层强制；缺了 400，stage-1 拿来是 409）。
 *   - Clerk（web）→ `channel: 'WEB'`，无回执：面板上就是那个人自己在点。
 *
 * 两条都**不按身份拒人**。LUM-750 曾加过 agent 会话守卫，同日被撤回（PR 1006）——
 * 用户的实际工作流就是让 agent 代跑握手、自己在聊天里逐步批准。别再加回来。
 * 保护来自握手顺序 + `channel` 留痕，不是「你是谁」。
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  const { id: rawId, runId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = disposeDefectBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const row = await testCaseDefectDispositionService.rule({
      owner: { kind: 'task', taskId: task.id },
      runId,
      ruling: parsed.data.disposition,
      note: parsed.data.note ?? null,
      caller: {
        sessionId: request.headers.get('X-Lumo-Session-Id'),
        memberId: identity.memberId,
      },
      channel: identity.source === 'bearer' ? 'CLI' : 'WEB',
      receipt: parsed.data.receipt,
      audit: {
        workspaceId: identity.workspaceId,
        context: memberAuditContext(
          request.headers,
          { clerkId: identity.clerkId, memberId: identity.memberId },
          identity.source
        ),
      },
    })
    return NextResponse.json(row, { status: 201 })
  } catch (error) {
    const maybeStatus = (error as { status?: unknown } | null)?.status
    const status = typeof maybeStatus === 'number' ? maybeStatus : 500
    const message =
      status === 500 || !(error instanceof Error)
        ? 'Internal Server Error'
        : error.message
    return NextResponse.json({ error: message }, { status })
  }
}
