'use client'

import { useIntl } from 'react-intl'
import { useTaskRetrospective } from '../hooks/useTaskRetrospective'
import type { Interval } from '@/lib/forecast/types'
import { RangeBand } from './RangeBand'
import { fmtCompact } from './AgentRunTimeline/model-cost-format'
import type {
  RetrospectiveMetric,
  VarianceBand,
} from '@/lib/forecast/retrospective-types'
import type { ApiStatus } from '../types'

const BAND_KEY: Record<VarianceBand, string> = {
  within: 'retrospective.bandWithin',
  above: 'retrospective.bandAbove',
  below: 'retrospective.bandBelow',
}

// Variance pill: layered feedback tokens — success-subtle for "within",
// warning-subtle for "above"/"below". Colour is a light hint; hierarchy
// comes from the numbers' weight, not the pill's colour.
function VariancePill({ metric }: { metric: RetrospectiveMetric }) {
  const intl = useIntl()
  if (metric.band === null || metric.deltaPct === null) return null
  const tone =
    metric.band === 'within'
      ? 'bg-success-subtle text-success'
      : 'bg-warning-subtle text-warning'
  const sign = metric.deltaPct > 0 ? '+' : ''
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-caption font-medium ${tone}`}
    >
      {sign}
      {metric.deltaPct}% · {intl.formatMessage({ id: BAND_KEY[metric.band] })}
    </span>
  )
}

function range(
  intl: ReturnType<typeof useIntl>,
  iv: Interval,
  fmt: (n: number) => string
) {
  return intl.formatMessage(
    { id: 'forecast.range' },
    { median: fmt(iv.median), low: fmt(iv.p25), high: fmt(iv.p75) }
  )
}

// Delivery row: shows predicted range · actual N; degrades to actual N ·
// "no forecast history yet" when forecast is absent.
function CompareRow({
  label,
  metric,
}: {
  label: string
  metric: RetrospectiveMetric
}) {
  const intl = useIntl()
  const fmt = (n: number) => String(Math.round(n))
  return (
    <div className='flex items-baseline justify-between gap-2 py-1'>
      <span className='text-caption text-foreground'>{label}</span>
      <span className='text-right text-caption text-muted-foreground tabular-nums'>
        {metric.forecast ? (
          <>
            {intl.formatMessage(
              { id: 'retrospective.predicted' },
              { value: range(intl, metric.forecast, fmt) }
            )}
            <span className='mx-1.5 text-muted-foreground/60'>·</span>
            <span className='font-semibold text-foreground'>
              {intl.formatMessage(
                { id: 'retrospective.actual' },
                { value: metric.actual ?? '—' }
              )}
            </span>
          </>
        ) : (
          <>
            <span className='font-semibold text-foreground'>
              {intl.formatMessage(
                { id: 'retrospective.actual' },
                { value: metric.actual ?? '—' }
              )}
            </span>
            <span className='mx-1.5 text-muted-foreground/60'>·</span>
            {intl.formatMessage({ id: 'retrospective.noForecast' })}
          </>
        )}
      </span>
    </div>
  )
}

export function RetrospectivePanel({
  taskId,
  status,
}: {
  taskId: string
  status: ApiStatus
}) {
  const intl = useIntl()
  const isTerminal = status === 'DONE'
  const { retrospective, isLoading, error } = useTaskRetrospective(
    isTerminal ? taskId : null
  )

  if (!isTerminal) return null
  if (isLoading || error || !retrospective) return null

  const { tokenCost, iterations, clarifyRounds, referenceLibrarySize } =
    retrospective
  const showToken = !!tokenCost.forecast && tokenCost.actual !== null

  return (
    <section className='mt-6 border-t border-border pt-6'>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <p className='text-caption font-semibold uppercase tracking-wider text-muted-foreground'>
          {intl.formatMessage({ id: 'retrospective.title' })}
        </p>
        <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'retrospective.done' })}
        </span>
      </div>

      {showToken && tokenCost.forecast && (
        <div className='mb-4'>
          <p className='mb-2 text-caption text-muted-foreground'>
            {intl.formatMessage({ id: 'retrospective.tokenUsage' })}
          </p>
          <div className='flex items-baseline justify-between gap-3'>
            <span className='text-caption text-muted-foreground'>
              {intl.formatMessage(
                { id: 'retrospective.predicted' },
                { value: fmtCompact(intl, tokenCost.forecast.median) }
              )}
            </span>
            <span className='text-right'>
              <span className='mr-1.5 text-caption text-muted-foreground'>
                {intl.formatMessage({ id: 'retrospective.actualLabel' })}
              </span>
              <span className='text-title-strong text-foreground tabular-nums'>
                {fmtCompact(intl, tokenCost.actual as number)}
              </span>
            </span>
          </div>
          <VariancePill metric={tokenCost} />
          <RangeBand
            forecast={tokenCost.forecast}
            actual={tokenCost.actual as number}
          />
        </div>
      )}

      <div className='border-t border-border pt-3'>
        <p className='mb-1 text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'retrospective.delivery' })}
        </p>
        <CompareRow
          label={intl.formatMessage({ id: 'retrospective.iterations' })}
          metric={iterations}
        />
        <CompareRow
          label={intl.formatMessage({ id: 'retrospective.clarifyRounds' })}
          metric={clarifyRounds}
        />
      </div>

      <div className='mt-4 flex items-start gap-2.5 rounded-xl bg-muted/50 px-3 py-3'>
        <span className='mt-0.5 text-info' aria-hidden>
          ↻
        </span>
        <p className='text-caption leading-relaxed text-muted-foreground'>
          {intl.formatMessage(
            { id: 'retrospective.flywheel' },
            { count: referenceLibrarySize }
          )}
        </p>
      </div>
    </section>
  )
}
