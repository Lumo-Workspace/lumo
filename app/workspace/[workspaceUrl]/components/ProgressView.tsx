'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import type {
  ProgressMetric,
  TaskProgress,
} from '@/lib/forecast/progress-types'
import { RangeBand } from './RangeBand'
import { fmtCompact } from './AgentRunTimeline/model-cost-format'

// over 预警 pill（warning token）。on-track 不渲染 —— 飞行途中偏低是正常进度。
function OverPill({ metric }: { metric: ProgressMetric }) {
  const intl = useIntl()
  if (metric.band !== 'over' || metric.deltaPct === null) return null
  const sign = metric.deltaPct > 0 ? '+' : ''
  return (
    <span className='inline-flex items-center gap-1.5 rounded-full bg-warning-subtle px-2.5 py-0.5 text-caption font-medium text-warning'>
      {sign}
      {metric.deltaPct}% · {intl.formatMessage({ id: 'progress.over' })}
    </span>
  )
}

// 进度行：预测区间 · 已 N。over 时 actual 标 warning 色。forecast 缺失 → 仅 actual。
function ProgressCompareRow({
  label,
  metric,
}: {
  label: string
  metric: ProgressMetric
}) {
  const intl = useIntl()
  const over = metric.band === 'over'
  const rangeText = metric.forecast
    ? intl.formatMessage(
        { id: 'progress.predictedRange' },
        {
          value: `${Math.round(metric.forecast.p25)}–${Math.round(metric.forecast.p75)}`,
        }
      )
    : null
  return (
    <div className='flex items-baseline justify-between gap-2 py-1'>
      <span className='text-caption text-foreground'>{label}</span>
      <span className='text-right text-caption text-muted-foreground tabular-nums'>
        {rangeText && (
          <>
            {rangeText}
            <span className='mx-1.5 text-muted-foreground/60'>·</span>
          </>
        )}
        <span
          className={`font-semibold ${over ? 'text-warning' : 'text-foreground'}`}
        >
          {intl.formatMessage(
            { id: 'progress.soFar' },
            { value: metric.actual ?? '—' }
          )}
        </span>
      </span>
    </div>
  )
}

// 无预测时的中性进行态摘要行：左对齐自然语言事实句，不走 forecast 对比框架。
function SummaryLine({ children }: { children: ReactNode }) {
  return (
    <li className='py-1 text-body-strong text-foreground tabular-nums'>
      {children}
    </li>
  )
}

/** 交付中态：活预测 + 累计 actual 的实时 burn 对比；无预测时降级为中性进行态摘要。 */
export function ProgressView({
  progress,
  agentStatus,
}: {
  progress: TaskProgress
  agentStatus?: string | null
}) {
  const intl = useIntl()
  const { tokenCost, iterations, clarifyRounds } = progress
  const running = agentStatus === 'WORKING'
  const tokenOver = tokenCost.band === 'over'

  // token 是独立轨道；cohort 指标 iterations/clarifyRounds 同生同灭（判一个即可）。
  const hasTokenBand = !!tokenCost.forecast && tokenCost.actual !== null
  const hasCohortForecast = !!iterations.forecast
  const showTokenSummary =
    !hasTokenBand && tokenCost.actual !== null && tokenCost.actual > 0
  const showClarifySummary =
    clarifyRounds.actual !== null && clarifyRounds.actual > 0

  return (
    <section className='rounded-lg border border-border bg-card p-4'>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <p className='text-caption font-semibold uppercase tracking-wider text-muted-foreground'>
          {intl.formatMessage({ id: 'progress.title' })}
        </p>
        {running && (
          <span className='inline-flex shrink-0 items-center gap-1.5 rounded-full bg-info-subtle px-2.5 py-0.5 text-caption font-medium text-info'>
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
                className={`text-title-strong tabular-nums ${tokenOver ? 'text-warning' : 'text-foreground'}`}
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
        </div>
      )}

      {hasCohortForecast ? (
        <div className='border-t border-border pt-3'>
          <p className='mb-1 text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'progress.sectionLabel' })}
          </p>
          <ProgressCompareRow
            label={intl.formatMessage({ id: 'progress.iterations' })}
            metric={iterations}
          />
          <ProgressCompareRow
            label={intl.formatMessage({ id: 'progress.clarifyRounds' })}
            metric={clarifyRounds}
          />
        </div>
      ) : (
        <ul className='border-t border-border pt-3'>
          <SummaryLine>
            {intl.formatMessage(
              { id: 'progress.summaryRuns' },
              { value: iterations.actual ?? 0 }
            )}
          </SummaryLine>
          {showTokenSummary && (
            <SummaryLine>
              {intl.formatMessage(
                { id: 'progress.summaryTokens' },
                { value: fmtCompact(intl, tokenCost.actual as number) }
              )}
            </SummaryLine>
          )}
          {showClarifySummary && (
            <SummaryLine>
              {intl.formatMessage(
                { id: 'progress.summaryClarify' },
                { value: clarifyRounds.actual as number }
              )}
            </SummaryLine>
          )}
        </ul>
      )}
    </section>
  )
}
