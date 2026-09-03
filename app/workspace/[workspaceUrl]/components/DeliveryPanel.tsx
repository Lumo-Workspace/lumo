'use client'

import type { ReactNode } from 'react'
import { useTaskProgress } from '../hooks/useTaskProgress'
import { ForecastView } from './ForecastView'
import { ProgressView } from './ProgressView'
import type { ApiStatus } from '../types'

/**
 * 交付卡编排器（LUM-733 起两态）。
 * - 一次 useTaskProgress：sessionCount===0 且未交付 → ForecastView（交付前）；
 *   sessionCount≥1 → ProgressView（交付中 / 交付后都只看实际值，不再对比预测）
 * - 已交付（DONE）且没有任何 session → 不渲染（一个已交付任务没有"预测"可看）
 * loading/error/无数据 → 不渲染（保持 sidebar 安静）。
 * 交付时的 forecast 快照仍在服务端冻结（`lumo outcome rate` 的分桶依赖它），
 * 只是不再有回顾面板读它。
 */
export function DeliveryPanel({
  taskId,
  status,
  agentStatus,
  footer,
}: {
  taskId: string
  status: ApiStatus
  agentStatus?: string | null | undefined
  footer?: ReactNode
}) {
  const isTerminal = status === 'DONE'
  const { progress, isLoading, error } = useTaskProgress(taskId)

  if (isLoading || error || !progress) return null
  if (progress.sessionCount === 0) {
    if (isTerminal) return null
    return <ForecastView forecast={progress.forecast} footer={footer} />
  }
  return (
    <ProgressView
      progress={progress}
      agentStatus={agentStatus ?? null}
      footer={footer}
    />
  )
}
