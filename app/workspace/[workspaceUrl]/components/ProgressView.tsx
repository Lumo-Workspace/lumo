'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { Card } from '@/components/ui/card'
import type {
  ProgressMetric,
  TaskProgress,
} from '@/lib/forecast/progress-types'
import { RangeBand } from './RangeBand'
import { DeliveryKpis } from './DeliveryKpis'
import { fmtCompact } from './AgentRunTimeline/model-cost-format'
import { noBaseline } from '@/lib/baseline/adapters'

// over 预警 pill（warning token）。on-track 不渲染 —— 飞行途中偏低是正常进度。
function OverPill({ metric }: { metric: ProgressMetric }) {
  const intl = useIntl()
  if (metric.band !== 'over' || metric.deltaPct === null) return null
  const sign = metric.deltaPct > 0 ? '+' : ''
  return (
    <span className='inline-flex items-center gap-1.5 rounded-full bg-warning-subtle px-2.5 py-0.5 text-caption text-warning-text'>
      {sign}
      {metric.deltaPct}% · {intl.formatMessage({ id: 'progress.over' })}
    </span>
  )
}

/** 交付中态：活预测 + 累计 actual 的实时 burn 对比；底部 KPI 与交付后共用同一块。 */
export function ProgressView({
  progress,
  agentStatus,
  footer,
  preDedupe = false,
}: {
  progress: TaskProgress
  agentStatus?: string | null
  footer?: ReactNode
  /** LUM-932: some run predates the usage-dedupe fix (token usage notice). */
  preDedupe?: boolean
}) {
  const intl = useIntl()
  const { tokenCost, iterations, interactionRounds, totalDuration } = progress
  const running = agentStatus === 'WORKING'
  const tokenOver = tokenCost.band === 'over'

  const hasTokenBand = !!tokenCost.forecast && tokenCost.actual !== null
  // 无预测区间但有累计用量时，token 仍归 token 区（一行 已用 X），KPI 块只剩三项。
  const showTokenUsedOnly =
    !hasTokenBand && tokenCost.actual !== null && tokenCost.actual > 0

  return (
    <Card asChild className='p-4'>
      <section>
        <div className='mb-3 flex items-center justify-between gap-2'>
          <p className='text-caption font-semibold uppercase tracking-wider text-muted-foreground'>
            {intl.formatMessage({ id: 'progress.title' })}
          </p>
          {running && (
            <span className='inline-flex shrink-0 items-center gap-1.5 rounded-full bg-info-subtle px-2.5 py-0.5 text-caption text-info-text'>
              <span className='size-1.5 rounded-full bg-info' aria-hidden />
              {intl.formatMessage({ id: 'progress.agentRunning' })}
            </span>
          )}
        </div>

        {hasTokenBand && tokenCost.forecast && (
          <div className='mb-4'>
            <p className='mb-2 text-caption text-muted-foreground'>
              {intl.formatMessage({ id: 'progress.tokenUsage' })}
            </p>
            <div className='flex items-baseline justify-between gap-3'>
              <span className='text-caption text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'progress.predictedMedian' },
                  { value: fmtCompact(intl, tokenCost.forecast.median) }
                )}
              </span>
              <span className='text-right'>
                <span className='mr-1.5 text-caption text-muted-foreground'>
                  {intl.formatMessage({ id: 'progress.usedLabel' })}
                </span>
                <span
                  className={`text-title-strong tabular-nums ${tokenOver ? 'text-warning-text' : 'text-foreground'}`}
                >
                  {fmtCompact(intl, tokenCost.actual as number)}
                </span>
              </span>
            </div>
            <OverPill metric={tokenCost} />
            <RangeBand
              forecast={tokenCost.forecast}
              actual={tokenCost.actual as number}
              tone={tokenOver ? 'warning' : 'info'}
            />
            {!tokenOver && (
              <p className='text-caption text-muted-foreground'>
                {intl.formatMessage({ id: 'progress.onTrackNote' })}
              </p>
            )}
            {preDedupe && (
              <p
                data-testid='usage-pre-dedupe'
                className='mt-1 text-caption text-warning-text'
              >
                {intl.formatMessage({ id: 'usage.preDedupe.notice' })}
              </p>
            )}
          </div>
        )}

        {showTokenUsedOnly && (
          <div className='mb-4'>
            <p className='mb-2 text-caption text-muted-foreground'>
              {intl.formatMessage({ id: 'progress.tokenUsage' })}
            </p>
            <div className='flex items-baseline justify-end gap-3'>
              <span className='mr-1.5 text-caption text-muted-foreground'>
                {intl.formatMessage({ id: 'progress.usedLabel' })}
              </span>
              <span className='text-title-strong text-foreground tabular-nums'>
                {fmtCompact(intl, tokenCost.actual as number)}
              </span>
            </div>
            {preDedupe && (
              <p
                data-testid='usage-pre-dedupe'
                className='mt-1 text-caption text-warning-text'
              >
                {intl.formatMessage({ id: 'usage.preDedupe.notice' })}
              </p>
            )}
          </div>
        )}

        {footer}

        {/* KPI block sits last — after the per-model footer — to match the done
          card's order (token → per-model breakdown → 交付 KPIs). */}
        <DeliveryKpis
          runs={noBaseline(iterations.actual)}
          interactionRounds={noBaseline(interactionRounds.actual)}
          duration={noBaseline(totalDuration.actual)}
        />
      </section>
    </Card>
  )
}
