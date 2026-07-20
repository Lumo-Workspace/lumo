'use client'

import { useIntl } from 'react-intl'
import { useSprintBurnup } from '../../hooks/useSprints'
import {
  buildBurnupSparkline,
  SPARKLINE_VB_W as VB_W,
  SPARKLINE_VB_H as VB_H,
} from './burnup-sparkline'

interface Props {
  sprintId: string
  formatDate: (d: string | Date) => string
}

/**
 * Compact burnup sparkline for the sprint "Burnup" stat card. Reuses the same
 * `useSprintBurnup` data the full chart consumes; renders a dependency-free
 * inline SVG at the card's height.
 */
export function SprintBurnupSparkline({ sprintId, formatDate }: Props) {
  const intl = useIntl()
  const { burnup, isLoading } = useSprintBurnup(sprintId)

  if (isLoading) {
    return <div className='h-[52px] animate-pulse rounded-sm bg-muted' />
  }

  const geo = burnup
    ? buildBurnupSparkline(burnup.series, burnup.scopeTotal)
    : null

  if (!geo?.hasData || !burnup) {
    return (
      <p className='py-4 text-caption text-muted-foreground'>
        {intl.formatMessage({
          id: 'sprints.detail.burnupEmpty',
          defaultMessage: 'Not enough data yet',
        })}
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-2'>
      <svg
        width='100%'
        height='52'
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio='none'
        aria-hidden
      >
        <defs>
          <linearGradient id={`burnup-${sprintId}`} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='5%' stopColor='var(--chart-1)' stopOpacity='0.3' />
            <stop offset='95%' stopColor='var(--chart-1)' stopOpacity='0.02' />
          </linearGradient>
        </defs>
        <path d={geo.areaPath} fill={`url(#burnup-${sprintId})`} />
        <path
          className='text-muted-foreground'
          d={geo.ceilingPath}
          stroke='currentColor'
          strokeWidth='1.5'
          opacity='0.5'
          fill='none'
        />
        <path
          d={geo.linePath}
          stroke='var(--chart-1)'
          strokeWidth='2.5'
          fill='none'
        />
        {geo.projectedPath && (
          <path
            d={geo.projectedPath}
            stroke='var(--chart-1)'
            strokeWidth='2'
            strokeDasharray='5 4'
            fill='none'
          />
        )}
      </svg>
      <div className='flex justify-between text-caption text-muted-foreground'>
        <span>{formatDate(burnup.start)}</span>
        <span>{formatDate(burnup.end)}</span>
      </div>
    </div>
  )
}
