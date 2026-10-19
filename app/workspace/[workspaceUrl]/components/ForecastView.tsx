'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { Card } from '@/components/ui/card'
import type {
  Interval,
  ForecastConfidence,
  TaskForecast,
} from '@/lib/forecast/types'
import { fmtCompact } from './AgentRunTimeline/model-cost-format'
import { Badge } from '@/components/ui/badge'

function ForecastRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-baseline justify-between gap-2 py-1'>
      <span className='shrink-0 text-caption text-muted-foreground'>
        {label}
      </span>
      <span className='text-right text-body-strong text-foreground tabular-nums'>
        {value}
      </span>
    </div>
  )
}

const CONFIDENCE_KEY: Record<ForecastConfidence, string> = {
  low: 'forecast.confidenceLow',
  medium: 'forecast.confidenceMedium',
  high: 'forecast.confidenceHigh',
}

// Neutral evidence-strength badge — intentionally greyscale (no status color).
function ConfidenceBadge({ level }: { level: ForecastConfidence }) {
  const intl = useIntl()
  return (
    <Badge variant='muted' size='sm' className='shrink-0'>
      {intl.formatMessage({ id: 'forecast.confidence' })}
      {' · '}
      {intl.formatMessage({ id: CONFIDENCE_KEY[level] })}
    </Badge>
  )
}

/** 交付前的纯预测视图。forecast 由编排器传入（不自取数）。 */
export function ForecastView({
  forecast,
  footer,
}: {
  forecast: TaskForecast
  footer?: ReactNode
}) {
  const intl = useIntl()
  const [showSources, setShowSources] = useState(false)
  const title = intl.formatMessage({ id: 'forecast.title' })

  if (forecast.insufficientData) {
    return (
      <Card asChild className='p-4'>
        <section>
          <p className='text-caption font-semibold text-muted-foreground uppercase tracking-wider mb-2'>
            {title}
          </p>
          <p className='text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'forecast.insufficient' })}
          </p>
          {footer && (
            <div className='mt-4 border-t border-border pt-3'>{footer}</div>
          )}
        </section>
      </Card>
    )
  }

  const round = (n: number) => Math.round(n)
  const numRange = (iv: Interval) =>
    intl.formatMessage(
      { id: 'forecast.range' },
      { median: round(iv.median), low: round(iv.p25), high: round(iv.p75) }
    )
  const cycleText = (iv: Interval) => {
    const useHours = iv.median < 24
    const div = useHours ? 1 : 24
    return intl.formatMessage(
      { id: useHours ? 'forecast.cycleHours' : 'forecast.cycleDays' },
      {
        median: round(iv.median / div),
        low: round(iv.p25 / div),
        high: round(iv.p75 / div),
      }
    )
  }
  const compact = (n: number) => fmtCompact(intl, n)
  const tokenRange = (iv: Interval) =>
    intl.formatMessage(
      { id: 'forecast.range' },
      {
        median: compact(iv.median),
        low: compact(iv.p25),
        high: compact(iv.p75),
      }
    )

  const hasCohortMetrics = !!forecast.iterations

  return (
    <Card asChild className='p-4'>
      <section>
        <div className='flex items-center justify-between gap-2 mb-1'>
          <p className='text-caption font-semibold text-muted-foreground uppercase tracking-wider'>
            {title}
          </p>
          <ConfidenceBadge level={forecast.confidence} />
        </div>
        {hasCohortMetrics && (
          <p className='text-caption text-muted-foreground mb-2'>
            {intl.formatMessage(
              { id: 'forecast.basis' },
              { count: forecast.cohortSize }
            )}
          </p>
        )}

        {forecast.iterations && (
          <ForecastRow
            label={intl.formatMessage({ id: 'forecast.metricIterations' })}
            value={numRange(forecast.iterations)}
          />
        )}
        {forecast.mergedPrs && (
          <ForecastRow
            label={intl.formatMessage({ id: 'forecast.metricPrs' })}
            value={numRange(forecast.mergedPrs)}
          />
        )}
        {forecast.cycleHours && (
          <ForecastRow
            label={intl.formatMessage({ id: 'forecast.metricCycle' })}
            value={cycleText(forecast.cycleHours)}
          />
        )}

        {forecast.tokenCost && (
          <>
            <ForecastRow
              label={intl.formatMessage({ id: 'forecast.metricTokens' })}
              value={tokenRange(forecast.tokenCost)}
            />
            <p className='text-caption text-muted-foreground mt-1'>
              {intl.formatMessage(
                { id: 'forecast.tokenBasis' },
                { count: forecast.tokenCostBasis }
              )}
            </p>
          </>
        )}

        {forecast.sources.length > 0 && (
          <>
            <button
              type='button'
              onClick={() => setShowSources(v => !v)}
              className='mt-2 text-caption text-muted-foreground hover:text-foreground transition-colors'
            >
              {intl.formatMessage({ id: 'forecast.viewSources' })}
            </button>
            {showSources && (
              <ul className='mt-2 space-y-1'>
                {forecast.sources.map(s => (
                  <li
                    key={s.taskId}
                    className='text-caption text-muted-foreground'
                  >
                    {s.identifier} · {s.title}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {footer && (
          <div className='mt-4 border-t border-border pt-3'>{footer}</div>
        )}
      </section>
    </Card>
  )
}
