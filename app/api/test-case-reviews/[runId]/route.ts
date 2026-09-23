import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { testCaseReviewService } from '@/lib/services/test-case-review.service'
import { runReviewBodySchema } from '@/lib/validation/test-case'
import { zodError } from '@/lib/api/helpers'

export const runtime = 'nodejs'

type Params = { params: Promise<{ runId: string }> }

/**
 * POST /api/test-case-reviews/[runId] — LUM-819 (D) 记一条人工抽查复核。
 *
 * RED LINE: 复核是「某个人亲眼看过证据并裁定」。服务端分不出是谁点的，agent
 * 代点就是凭空造出一个人已裁定的事实。所以 bearer 身份（agent / CLI 的认证
 * 路径）在**解析 body 之前**就 403——与 human-verdict 路由同一条信任边界。
 * 只有 Clerk 浏览器会话能写。
 */
export async function POST(request: NextRequest, { params }: Params) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  if (identity.source !== 'clerk') {
    return NextResponse.json(
      {
        error:
          'Run reviews can only be recorded from a human-authenticated browser session — the agent/CLI path is closed by design',
      },
      { status: 403 }
    )
  }

  const { runId } = await params
  const body = await request.json().catch(() => null)
  const parsed = runReviewBodySchema.safeParse(body)
  if (!parsed.success) return zodError(parsed)

  try {
    return NextResponse.json(
      await testCaseReviewService.recordReview(
        runId,
        identity.workspaceId,
        identity.memberId,
        parsed.data
      )
    )
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
