'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { useSprintBurnup } from '../../hooks/useSprints'
import {
  buildBurnupChart,
  nearestPointIndex,
  CHART_VB_W as VB_W,
  CHART_VB_H as VB_H,
  PLOT,
} from './burnup-chart'

interface Props {
  sprintId: string
  /** Task counts for the resting readout — the sprint's own progress. */
  progress: { done: number; total: number }
  /** Sprint end day, already formatted in the calendar-day frame. */
  endLabel: string
  formatDate: (d: string | Date) => string
}

/** Plan values land on halves; measured ones are whole tasks. */
const fmtCount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * The single card that heads the sprint detail page. It carries the burnup
 * curve plus a one-line readout that folds in what used to be two more cards
 * (the progress ring and the time-left card): at rest it states how much of the
 * sprint is done and when it ends, and on hover it reads out the pointed-at
 * day — measured completions where they exist, the plan beyond them.
 */
export function SprintBurnupCard({
  sprintId,
  progress,
  endLabel,
  formatDate,
}: Props) {
  const intl = useIntl()
  const { burnup, isLoading } = useSprintBurnup(sprintId)
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const geo = burnup ? buildBurnupChart(burnup.series, burnup.scopeTotal) : null
  const hovered =
    geo && hoverIndex !== null ? (geo.points[hoverIndex] ?? null) : null

  const restingReadout = intl.formatMessage(
    {
      id: 'sprints.detail.burnupReadout',
      defaultMessage: '{done} / {total} done · ends {date}',
    },
    { done: progress.done, total: progress.total, date: endLabel }
  )

  const readout = hovered
    ? intl.formatMessage(
        hovered.isMeasured
          ? {
              id: 'sprints.detail.burnupDayActual',
              defaultMessage: '{date} · {done} / {total} done',
            }
          : {
              id: 'sprints.detail.burnupDayPlan',
              defaultMessage: '{date} · {done} / {total} planned',
            },
        {
          date: formatDate(hovered.date),
          done: fmtCount(
            hovered.isMeasured ? (hovered.completed as number) : hovered.ideal
          ),
          total: burnup?.scopeTotal ?? progress.total,
        }
      )
    : restingReadout

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!geo?.hasData) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const vbX = ((e.clientX - rect.left) / rect.width) * VB_W
    const next = nearestPointIndex(vbX, geo.points.length)
    setHoverIndex(prev => (prev === next ? prev : next))
  }

  return (
    <div className='rounded-lg border border-border px-4 pb-3 pt-3.5'>
      {/* Wraps rather than squeezing: in the ~320px rail the label and the
          readout don't always fit on one line. */}
      <div className='flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5'>
        <span className='text-caption font-semibold uppercase tracking-wider text-muted-foreground'>
          {intl.formatMessage({
            id: 'sprints.detail.burnup',
            defaultMessage: 'Burnup',
          })}
        </span>
        <span
          className='text-body tabular-nums text-muted-foreground'
          data-testid='burnup-readout'
        >
          {readout}
        </span>
      </div>

      {isLoading ? (
        <div className='mt-3 h-[150px] animate-pulse rounded-sm bg-muted' />
      ) : !geo?.hasData || !burnup ? (
        <p className='py-6 text-center text-caption text-muted-foreground'>
          {intl.formatMessage({
            id: 'sprints.detail.burnupEmpty',
            defaultMessage: 'Not enough data yet',
          })}
        </p>
      ) : (
        <div className='mt-1'>
          <div className='relative'>
            <svg
              viewBox={`0 0 ${VB_W} ${VB_H}`}
              className='block w-full cursor-crosshair'
              onMouseMove={handleMove}
              onMouseLeave={() => setHoverIndex(null)}
              role='img'
              aria-label={restingReadout}
            >
              {geo.ticks.map(tick => (
                <line
                  key={tick.value}
                  className='text-border'
                  x1={PLOT.left}
                  y1={tick.y}
                  x2={PLOT.right}
                  y2={tick.y}
                  stroke='currentColor'
                  strokeWidth='1'
                />
              ))}

              {/* Straight-line plan */}
              <path
                className='text-muted-foreground'
                d={geo.idealPath}
                fill='none'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeDasharray='4 4'
                opacity='0.5'
              />

              {/* Measured burnup */}
              <path d={geo.areaPath} fill='var(--chart-1)' opacity='0.08' />
              <path
                d={geo.linePath}
                fill='none'
                stroke='var(--chart-1)'
                strokeWidth='2.5'
                strokeLinecap='round'
                strokeLinejoin='round'
              />

              {hovered && (
                <g>
                  <line
                    className='text-border'
                    x1={hovered.x}
                    y1={PLOT.top - 6}
                    x2={hovered.x}
                    y2={PLOT.bottom + 6}
                    stroke='currentColor'
                    strokeWidth='1'
                  />
                  <circle
                    cx={hovered.x}
                    cy={hovered.y}
                    r='4.5'
                    fill={
                      hovered.isMeasured
                        ? 'var(--chart-1)'
                        : 'var(--muted-foreground)'
                    }
                    className='stroke-background'
                    strokeWidth='2'
                  />
                </g>
              )}
            </svg>

            {/* Scale labels ride the plot in HTML so the type stays at the
                design-system size however wide the chart scales. */}
            {geo.ticks.map(tick => (
              <span
                key={tick.value}
                className='pointer-events-none absolute -translate-y-1/2 pr-2 text-right text-caption tabular-nums text-muted-foreground'
                style={{
                  top: `${(tick.y / VB_H) * 100}%`,
                  left: 0,
                  width: `${(PLOT.left / VB_W) * 100}%`,
                }}
              >
                {fmtCount(tick.value)}
              </span>
            ))}
          </div>

          <div
            className='flex justify-between text-caption text-muted-foreground'
            style={{
              paddingLeft: `${(PLOT.left / VB_W) * 100}%`,
              paddingRight: `${((VB_W - PLOT.right) / VB_W) * 100}%`,
            }}
          >
            <span>{formatDate(burnup.start)}</span>
            <span>{formatDate(burnup.end)}</span>
          </div>
        </div>
      )}
    </div>
  )
}
