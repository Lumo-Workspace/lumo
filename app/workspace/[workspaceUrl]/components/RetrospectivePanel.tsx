'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import { useTaskRetrospective } from '../hooks/useTaskRetrospective'
import { RangeBand } from './RangeBand'
import { DeliveryKpis } from './DeliveryKpis'
import { fmtCompact } from './AgentRunTimeline/model-cost-format'
import { VariancePill } from '@/components/VariancePill'
import { fromRetrospectiveMetric } from '@/lib/baseline/adapters'
import type { ApiStatus } from '../types'

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
          <VariancePill
            band={tokenCost.band}
            deltaPct={tokenCost.deltaPct}
            deltaKind='magnitude'
          />
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
        runs={fromRetrospectiveMetric(
          iterations,
          referenceLibrarySize,
          'magnitude'
        )}
        interactionRounds={fromRetrospectiveMetric(
          interactionRounds,
          referenceLibrarySize,
          'magnitude'
        )}
        duration={fromRetrospectiveMetric(totalDuration, 0, 'magnitude')}
      />
    </section>
  )
}
