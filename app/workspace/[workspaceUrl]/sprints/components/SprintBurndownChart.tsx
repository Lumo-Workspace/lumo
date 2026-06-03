'use client'

import { useIntl } from 'react-intl'
import { useSprintBurndown } from '../../hooks/useSprints'

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
    <div className='rounded-lg border border-border p-3'>
      <h3 className='mb-2 text-sm font-medium text-foreground'>{title}</h3>
      {children}
    </div>
  )
}

export function SprintBurndownChart({ sprintId }: { sprintId: string }) {
  const intl = useIntl()
  const { burndown, isLoading } = useSprintBurndown(sprintId)
  const title = intl.formatMessage({ id: 'sprint.burndown.title' })

  if (isLoading || !burndown) {
    return (
      <Card title={title}>
        <div className='h-[120px] animate-pulse rounded bg-muted' />
      </Card>
    )
  }

  const { series, total } = burndown
  if (series.length === 0 || total === 0) {
    return (
      <Card title={title}>
        <p className='py-6 text-center text-xs text-muted-foreground'>
          {intl.formatMessage({ id: 'sprint.burndown.empty' })}
        </p>
      </Card>
    )
  }

  const n = series.length
  const maxY = Math.max(total, 1)
  const x = (i: number) =>
    PAD.left + (n === 1 ? PLOT_W / 2 : (PLOT_W * i) / (n - 1))
  const y = (v: number) => PAD.top + PLOT_H - (PLOT_H * v) / maxY

  const idealPoints = series.map((p, i) => `${x(i)},${y(p.ideal)}`).join(' ')
  const actualPoints = series
    .map((p, i) => (p.remaining === null ? null : `${x(i)},${y(p.remaining)}`))
    .filter((s): s is string => s !== null)
    .join(' ')

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
          points={idealPoints}
          fill='none'
          className='text-muted-foreground'
          stroke='currentColor'
          strokeWidth={1.5}
          strokeDasharray='4 3'
        />
        <polyline
          points={actualPoints}
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
      <div className='mt-1 flex items-center gap-4 text-xs text-muted-foreground'>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 bg-primary' />
          {intl.formatMessage({ id: 'sprint.burndown.remaining' })}
        </span>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 border-t border-dashed border-muted-foreground' />
          {intl.formatMessage({ id: 'sprint.burndown.ideal' })}
        </span>
      </div>
    </Card>
  )
}
