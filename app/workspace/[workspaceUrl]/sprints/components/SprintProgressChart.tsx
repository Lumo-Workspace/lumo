'use client'

import { useIntl } from 'react-intl'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { SprintBurnupResponse } from '@/lib/api-client/sprints'
import { useSprintBurnup } from '../../hooks/useSprints'

type BurnupRow = SprintBurnupResponse['series'][number]

/**
 * Pure shaping of the burnup response into Recharts rows + the Y-axis ceiling.
 * Rows pass through unchanged (Recharts reads `date`/`scope`/`completed`/
 * `projected` directly and leaves a gap on `null`). `maxY` floors at 1 so an
 * all-zero sprint still renders a sane axis. Kept pure for unit testing without
 * mounting Recharts.
 */
export function buildBurnupChartData(burnup: SprintBurnupResponse): {
  rows: BurnupRow[]
  maxY: number
} {
  return {
    rows: burnup.series,
    maxY: Math.max(burnup.scopeTotal, 1),
  }
}

/** 'YYYY-MM-DD' → 'M/D' without timezone-sensitive Date parsing. */
function formatDay(date: string): string {
  const [, m, d] = date.split('-')
  return m && d ? `${Number(m)}/${Number(d)}` : date
}

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
  const scopeLabel = intl.formatMessage({ id: 'sprint.burnup.scope' })
  const completedLabel = intl.formatMessage({ id: 'sprint.burnup.completed' })
  const projectedLabel = intl.formatMessage({ id: 'sprint.burnup.projected' })

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

  const { rows, maxY } = buildBurnupChartData(burnup)

  const config = {
    completed: { label: completedLabel, color: 'var(--chart-1)' },
    scope: { label: scopeLabel, color: 'var(--muted-foreground)' },
    projected: { label: projectedLabel, color: 'var(--chart-1)' },
  } satisfies ChartConfig

  return (
    <Card title={title}>
      <ChartContainer config={config} className='aspect-[2/1] w-full'>
        <ComposedChart
          data={rows}
          margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id='sprint-burnup-fill' x1='0' y1='0' x2='0' y2='1'>
              <stop
                offset='5%'
                stopColor='var(--color-completed)'
                stopOpacity={0.35}
              />
              <stop
                offset='95%'
                stopColor='var(--color-completed)'
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey='date'
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={formatDay}
          />
          <YAxis
            width={28}
            domain={[0, maxY]}
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tickCount={3}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={value => formatDay(String(value))}
              />
            }
          />
          <Area
            dataKey='completed'
            type='monotone'
            stroke='var(--color-completed)'
            strokeWidth={2}
            fill='url(#sprint-burnup-fill)'
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
          <Line
            dataKey='scope'
            type='monotone'
            stroke='var(--color-scope)'
            strokeWidth={1.5}
            strokeOpacity={0.55}
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
          <Line
            dataKey='projected'
            type='monotone'
            stroke='var(--color-projected)'
            strokeWidth={1.5}
            strokeDasharray='4 3'
            connectNulls={false}
            isAnimationActive={false}
            dot={false}
          />
        </ComposedChart>
      </ChartContainer>
      <div className='mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground'>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 bg-muted-foreground' />
          {scopeLabel}
        </span>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 bg-chart-1' />
          {completedLabel}
        </span>
        <span className='flex items-center gap-1'>
          <span className='inline-block h-0.5 w-3 border-t border-dashed border-chart-1' />
          {projectedLabel}
        </span>
      </div>
    </Card>
  )
}
