'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { useTaskRetrospective } from '../hooks/useTaskRetrospective'
import { RangeBand } from './RangeBand'
import { DeliveryKpis } from './DeliveryKpis'
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

export function RetrospectivePanel({
  taskId,
  status,
  footer,
}: {
  taskId: string
  status: ApiStatus
  footer?: ReactNode
}) {
  const intl = useIntl()
  const isTerminal = status === 'DONE'
  const { retrospective, isLoading, error } = useTaskRetrospective(
    isTerminal ? taskId : null
  )

  if (!isTerminal) return null
  if (isLoading || error || !retrospective) return null

  const {
    tokenCost,
    iterations,
    interactionRounds,
    totalDuration,
    referenceLibrarySize,
  } = retrospective
  const showToken = !!tokenCost.forecast && tokenCost.actual !== null

  return (
    <section className='rounded-lg border border-border bg-card p-4'>
      <div className='mb-3 flex items-center justify-between gap-2'>
        <p className='text-caption font-semibold uppercase tracking-wider text-muted-foreground'>
          {intl.formatMessage({ id: 'retrospective.title' })}
        </p>
        <span className='shrink-0 rounded-full bg-muted px-2 py-0.5 text-caption text-muted-foreground'>
          {intl.formatMessage({ id: 'retrospective.done' })}
        </span>
      </div>

      <p className='mb-2 text-caption font-medium text-muted-foreground'>
        {intl.formatMessage({ id: 'retrospective.tokenUsage' })}
      </p>
      {showToken && tokenCost.forecast && (
        <div className='mb-2'>
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
      <p className='mb-2 text-caption text-muted-foreground'>
        {intl.formatMessage(
          { id: 'retrospective.flywheel' },
          { count: referenceLibrarySize }
        )}
      </p>
      {footer}

      <DeliveryKpis
        runs={iterations.actual}
        interactionRounds={interactionRounds.actual}
        duration={totalDuration.actual}
      />
    </section>
  )
}
