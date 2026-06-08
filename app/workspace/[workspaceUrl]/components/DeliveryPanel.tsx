'use client'

import { useTaskProgress } from '../hooks/useTaskProgress'
import { ForecastView } from './ForecastView'
import { ProgressView } from './ProgressView'
import { RetrospectivePanel } from './RetrospectivePanel'
import type { ApiStatus } from '../types'

/**
 * 交付卡三态编排器。
 * - 交付后（DONE）→ RetrospectivePanel（自取数，progress 取数禁用）
 * - 否则一次 useTaskProgress：sessionCount===0 → ForecastView（交付前）
 *   ；≥1 → ProgressView（交付中）
 * loading/error/无数据 → 不渲染（保持 sidebar 安静）。
 */
export function DeliveryPanel({
  taskId,
  status,
  agentStatus,
}: {
  taskId: string
  status: ApiStatus
  agentStatus?: string | null | undefined
}) {
  const isTerminal = status === 'DONE'
  const { progress, isLoading, error } = useTaskProgress(
    isTerminal ? null : taskId
  )

  if (isTerminal) return <RetrospectivePanel taskId={taskId} status={status} />
  if (isLoading || error || !progress) return null
  if (progress.sessionCount === 0)
    return <ForecastView forecast={progress.forecast} />
  return <ProgressView progress={progress} agentStatus={agentStatus ?? null} />
}
