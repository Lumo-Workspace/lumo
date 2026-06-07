'use client'

import { useIntl } from 'react-intl'
import { useSprintBurnup } from '../../hooks/useSprints'

const WIDTH = 288
const HEIGHT = 150
const PAD = { top: 10, right: 10, bottom: 22, left: 24 }
const PLOT_W = WIDTH - PAD.left - PAD.right
const PLOT_H = HEIGHT - PAD.top - PAD.bottom

function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className='mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground'>
        {title}
      </h3>
      {children}
    </div>
  )
}

export function SprintProgressChart({ sprintId }: { sprintId: string }) {
  const intl = useIntl()
  const { burnup, isLoading } = useSprintBurnup(sprintId)
  const title = intl.formatMessage({ id: 'sprint.burnup.title' })

  if (isLoading || !burnup) {
    return (
      <Card title={title}>
        <div className='h-[120px] animate-pulse rounded-sm bg-muted' />
      </Card>
    )
  }

  const { series, scopeTotal } = burnup
  if (series.length === 0 || scopeTotal === 0) {
    return (
      <Card title={title}>
        <p className='py-6 text-center text-xs text-muted-foreground'>
          {intl.formatMessage({ id: 'sprint.burnup.empty' })}
        </p>
      </Card>
    )
  }

  const n = series.length
  const maxY = Math.max(scopeTotal, 1)
  const x = (i: number) =>
    PAD.left + (n === 1 ? PLOT_W / 2 : (PLOT_W * i) / (n - 1))
  const y = (v: number) => PAD.top + PLOT_H - (PLOT_H * v) / maxY

  const line = (pick: (p: (typeof series)[number]) => number | null) =>
    series
      .map((p, i) => {
        const v = pick(p)
        return v === null ? null : `${x(i)},${y(v)}`
      })
      .filter((s): s is string => s !== null)
      .join(' ')

  const scopePoints = line(p => p.scope)
  const completedPoints = line(p => p.completed)
  const projectedPoints = line(p => p.projected)

  return (
    <Card title={title}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className='w-full'
        role='img'
        aria-label={title}
      >
        <title>{title}</title>
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={PAD.top + PLOT_H}
          className='stroke-border'
          strokeWidth={1}
        />
        <line
          x1={PAD.left}
          y1={PAD.top + PLOT_H}
          x2={PAD.left + PLOT_W}
          y2={PAD.top + PLOT_H}
          className='stroke-border'
          strokeWidth={1}
        />
        <polyline
          points={scopePoints}
          fill='none'
          className='text-muted-foreground'
          stroke='currentColor'
          strokeWidth={1.5}
        />
        <polyline
          points={projectedPoints}
          fill='none'
          className='text-primary'
          stroke='currentColor'
          strokeWidth={1.5}
          strokeDasharray='4 3'
        />
        <polyline
          points={completedPoints}
          fill='none'
          className='text-primary'
          stroke='currentColor'
          strokeWidth={2}
        />
        <text
          x={PAD.left - 4}
          y={PAD.top + 4}
          textAnchor='end'
          className='fill-muted-foreground text-[9px]'
        >
          {maxY}
        </text>
        <text
          x={PAD.left - 4}
          y={PAD.top + PLOT_H}
          textAnchor='end'
          className='fill-muted-foreground text-[9px]'
        >
          0
        </text>
      </svg>
      <div className='mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 bg-muted-foreground' />
          {intl.formatMessage({ id: 'sprint.burnup.scope' })}
        </span>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 bg-primary' />
          {intl.formatMessage({ id: 'sprint.burnup.completed' })}
        </span>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 border-t border-dashed border-primary' />
          {intl.formatMessage({ id: 'sprint.burnup.projected' })}
        </span>
      </div>
    </Card>
  )
}
