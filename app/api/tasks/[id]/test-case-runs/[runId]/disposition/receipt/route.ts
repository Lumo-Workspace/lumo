import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { resolveTaskParam } from '@/lib/api/resolve-task-param'
import { testCaseDefectDispositionService } from '@/lib/services/test-case-defect-disposition.service'
import { defectReceiptRequestSchema } from '@/lib/validation/test-case'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ id: string; runId: string }> }

/**
 * POST /api/tasks/[id]/test-case-runs/[runId]/disposition/receipt — LUM-812.
 * 握手的第 1、2 步，与越界侧同一套实现（`lib/disposition/read-receipt.ts`）。
 *
 * - body `{ disposition }`：第 1 步。服务端按这条 run **当前**的状态为这个裁定
 *   和这个调用方签一张 stage-1 回执，供 CLI 打印 exit-4 信封。
 * - body `{ disposition, acknowledge: <stage-1> }`：第 2 步。用户说读过了，
 *   服务端校验 stage-1 并换发写入那一步唯一接受的 stage-2。
 *
 * 两步都不写任何东西。bearer only：web 面板上没有需要转述的批准。
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'bearer') {
    return NextResponse.json(
      {
        error:
          'Read receipts belong to the CLI disposition path (bearer only) — the web panel dispositions directly',
      },
      { status: 403 }
    )
  }

  const { id: rawId, runId } = await params
  const task = await resolveTaskParam(rawId, identity.workspaceId)
  if (!task)
    return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = defectReceiptRequestSchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    const caller = {
      sessionId: request.headers.get('X-Lumo-Session-Id'),
      memberId: identity.memberId,
    }
    const issued = parsed.data.acknowledge
      ? await testCaseDefectDispositionService.acknowledgeReadReceipt(
          task.id,
          runId,
          parsed.data.disposition,
          parsed.data.acknowledge,
          caller
        )
      : await testCaseDefectDispositionService.issueReadReceipt(
          task.id,
          runId,
          parsed.data.disposition,
          caller
        )
    const describe = await testCaseDefectDispositionService.describe(
      task.id,
      runId
    )
    return NextResponse.json({ ...issued, subject: describe })
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
