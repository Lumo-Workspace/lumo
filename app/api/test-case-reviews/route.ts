import { NextRequest, NextResponse } from 'next/server'
import { requireIdentity } from '@/lib/auth'
import { testCaseReviewService } from '@/lib/services/test-case-review.service'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'

/**
 * GET /api/test-case-reviews — LUM-819 (D) 抽查页数据：一批随机抽出的待复核
 * run（报了 PASS、封顶后仍成立、还没人复核）+ workspace 的虚报率。
 *
 * 只读，任何已认证身份都可以看。写入在 `[runId]` 路由，只认浏览器会话。
 */
export async function GET(request: NextRequest) {
  const identity = await requireIdentity(request)
  if (identity instanceof NextResponse) return identity

  try {
    return NextResponse.json(
      await testCaseReviewService.getPool(identity.workspaceId)
    )
  } catch (error) {
    logger.error('testCaseReviews.pool.failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
