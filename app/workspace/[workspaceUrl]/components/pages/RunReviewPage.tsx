'use client'

import { useRunReviewPool } from '../../hooks/useRunReviewPool'
import { RunReviewView } from './RunReviewView'

/**
 * LUM-819 (D): 抽查页容器——取数与写入归 `useRunReviewPool`，渲染归
 * `RunReviewView`（SRP split，同 IdeaPoolPage）。
 */
export function RunReviewPage({ workspaceUrl }: { workspaceUrl: string }) {
  const { pool, loading, error, reload, review, reviewing, reviewError } =
    useRunReviewPool()

  return (
    <RunReviewView
      workspaceUrl={workspaceUrl}
      pool={pool}
      loading={loading}
      error={error}
      onReload={() => {
        void reload()
      }}
      reviewingRunId={reviewing}
      reviewError={reviewError}
      onReview={(runId, accepted, note) => {
        // 失败时缓存不动，这条 run 留在列表里可重试；错误经 reviewError 显示。
        review({ runId, accepted, note }).catch(() => undefined)
      }}
    />
  )
}
