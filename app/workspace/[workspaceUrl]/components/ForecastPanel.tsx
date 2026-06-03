'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useTaskForecast } from '../hooks/useTaskForecast'
import type { Interval } from '@/lib/forecast/types'
import type { ApiStatus } from '../types'

function ForecastRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex items-baseline justify-between py-1'>
      <span className='text-xs text-zinc-500 dark:text-zinc-400'>{label}</span>
      <span className='text-sm text-zinc-700 dark:text-zinc-300 tabular-nums'>
        {value}
      </span>
    </div>
  )
}

export function ForecastPanel({
  taskId,
  status,
}: {
  taskId: string
  status: ApiStatus
}) {
  const intl = useIntl()
  const [showSources, setShowSources] = useState(false)
  // A delivered task has no forecast to make — skip the fetch (null disables
  // the query) and render nothing rather than "insufficient data".
  const isTerminal = status === 'DONE'
  const { forecast, isLoading, error } = useTaskForecast(
    isTerminal ? null : taskId
  )

  if (isTerminal) return null

  // Hide entirely while loading or on error — keeps the sidebar quiet.
  if (isLoading || error || !forecast) return null

  const title = intl.formatMessage({ id: 'forecast.title' })

  if (forecast.insufficientData) {
    return (
      <section className='mt-6 pt-6 border-t border-zinc-100 dark:border-zinc-800'>
        <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-2'>
          {title}
        </p>
        <p className='text-sm text-zinc-500 dark:text-zinc-400'>
          {intl.formatMessage({ id: 'forecast.insufficient' })}
        </p>
      </section>
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

  return (
    <section className='mt-6 pt-6 border-t border-zinc-100 dark:border-zinc-800'>
      <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-1'>
        {title}
      </p>
      <p className='text-xs text-zinc-400 dark:text-zinc-500 mb-2'>
        {intl.formatMessage(
          { id: 'forecast.basis' },
          { count: forecast.cohortSize }
        )}
      </p>

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

      {forecast.sources.length > 0 && (
        <>
          <button
            type='button'
            onClick={() => setShowSources(v => !v)}
            className='mt-2 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors'
          >
            {intl.formatMessage({ id: 'forecast.viewSources' })}
          </button>
          {showSources && (
            <ul className='mt-2 space-y-1'>
              {forecast.sources.map(s => (
                <li
                  key={s.taskId}
                  className='text-xs text-zinc-500 dark:text-zinc-400'
                >
                  {s.identifier} · {s.title}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
