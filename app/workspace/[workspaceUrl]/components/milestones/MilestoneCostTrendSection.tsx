'use client'

import { useIntl } from 'react-intl'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { ApiMilestone } from '@/lib/api-client/milestones'

type MilestoneBurnupPayload = NonNullable<ApiMilestone['burnup']>

// Mirror the CLI's compact token formatter (notation:'compact',
// maximumFractionDigits:1) so the same number reads identically in both
// surfaces — the LUM-560 convention the task-level cost card already follows.
const TOKEN_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
function fmtTokens(n: number): string {
  return TOKEN_FMT.format(n)
}

/** Active (non-idle) seconds → a compact "2h 14m" / "3m 5s" / "12s"; 0 → "0s". */
function fmtDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec))
  if (sec === 0) return '0s'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0 && h === 0) parts.push(`${s}s`)
  return parts.join(' ')
}

export interface MilestoneBurnupBand {
  sprintId: string
  name: string
  x1: string
  x2: string
}

/**
 * Pure shaping of the milestone burnup payload into Recharts rows, the Y-axis
 * ceiling, and the covering sprints' bands clamped to the series' date domain
 * (a window that lies entirely outside the series is dropped; an ACTIVE
 * sprint's future days are cut at the series end). Kept pure for unit testing
 * without mounting Recharts.
 */
export function buildMilestoneBurnupChart(burnup: MilestoneBurnupPayload): {
  rows: MilestoneBurnupPayload['series']
  maxY: number
  bands: MilestoneBurnupBand[]
} {
  const bands: MilestoneBurnupBand[] = []
  for (const w of burnup.sprintWindows) {
    const x1 = w.start < burnup.start ? burnup.start : w.start
    const x2 = w.end > burnup.end ? burnup.end : w.end
    if (x1 > x2) continue
    bands.push({ sprintId: w.sprintId, name: w.name, x1, x2 })
  }
  return {
    rows: burnup.series,
    maxY: Math.max(burnup.scopeTotal, 1),
    bands,
  }
}

/**
 * 'YYYY-MM-DD' → a short, locale-ordered day label. Parsed by hand into a
 * local-time Date (no UTC string parse) so the rendered day can't slip across
 * a timezone boundary.
 */
function formatDay(date: string, locale?: string): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    month: 'numeric',
    day: 'numeric',
  })
}

interface MilestoneCostTrendSectionProps {
  costRollup: ApiMilestone['costRollup']
  burnup: ApiMilestone['burnup']
}

/**
 * LUM-627 — the Overview tab's cost + trajectory rollup: member tasks'
 * token/active-time actuals (same-source with the task-level LUM-560 cost)
 * and the cross-sprint burnup replay. Aggregates only — never a per-task
 * list. Honest by construction: an unmeasured token total states "not
 * measured" instead of implying a clean 0, and a task-less milestone gets an
 * explicit empty line, not a fake chart. Hierarchy via typography, not color.
 */
export function MilestoneCostTrendSection({
  costRollup,
  burnup,
}: MilestoneCostTrendSectionProps) {
  const intl = useIntl()
  // Older-server tolerance: without either enrich field there is nothing
  // honest to say — render nothing rather than fabricate placeholders.
  if (!costRollup && !burnup) return null

  const label = (id: string) => (
    <dt className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground'>
      {intl.formatMessage({ id })}
    </dt>
  )

  return (
    <section
      aria-label={intl.formatMessage({ id: 'milestone.costTrend.label' })}
      className='mb-10 max-w-3xl'
    >
      <p className='text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3'>
        {intl.formatMessage({ id: 'milestone.costTrend.title' })}
      </p>

      {costRollup && (
        <dl className='mb-6 flex flex-wrap gap-x-12 gap-y-4'>
          <div>
            {label('milestone.costTrend.tokens')}
            <dd className='mt-1 text-lg font-semibold tabular-nums'>
              {costRollup.tokenCost === null ? (
                <span className='font-normal text-muted-foreground'>
                  {intl.formatMessage({
                    id: 'milestone.costTrend.notMeasured',
                  })}
                </span>
              ) : (
                fmtTokens(costRollup.tokenCost)
              )}
            </dd>
            <dd className='mt-0.5 text-xs text-muted-foreground'>
              {intl.formatMessage(
                { id: 'milestone.costTrend.coverage' },
                {
                  measured: costRollup.measuredTasks,
                  total: costRollup.totalTasks,
                }
              )}
            </dd>
          </div>
          <div>
            {label('milestone.costTrend.activeTime')}
            <dd className='mt-1 text-lg font-semibold tabular-nums'>
              {fmtDuration(costRollup.activeTimeSec)}
            </dd>
          </div>
        </dl>
      )}

      {burnup && <BurnupChart burnup={burnup} />}
    </section>
  )
}

function BurnupChart({ burnup }: { burnup: MilestoneBurnupPayload }) {
  const intl = useIntl()
  const scopeLabel = intl.formatMessage({ id: 'milestone.costTrend.scope' })
  const completedLabel = intl.formatMessage({
    id: 'milestone.costTrend.completed',
  })

  if (burnup.series.length === 0 || burnup.scopeTotal === 0) {
    return (
      <p className='text-sm text-muted-foreground'>
        {intl.formatMessage({ id: 'milestone.costTrend.empty' })}
      </p>
    )
  }

  const { rows, maxY, bands } = buildMilestoneBurnupChart(burnup)

  const config = {
    completed: { label: completedLabel, color: 'var(--chart-1)' },
    scope: { label: scopeLabel, color: 'var(--muted-foreground)' },
  } satisfies ChartConfig

  return (
    <div>
      <h3 className='mb-3 text-sm font-medium text-foreground'>
        {intl.formatMessage({ id: 'milestone.costTrend.burnupTitle' })}
      </h3>
      <ChartContainer config={config} className='aspect-[2/1] w-full'>
        <ComposedChart
          data={rows}
          margin={{ top: 6, right: 6, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient
              id='milestone-burnup-fill'
              x1='0'
              y1='0'
              x2='0'
              y2='1'
            >
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
          {bands.map((b, i) => (
            <ReferenceArea
              key={b.sprintId}
              x1={b.x1}
              x2={b.x2}
              fill='var(--muted-foreground)'
              fillOpacity={i % 2 === 0 ? 0.06 : 0.12}
              stroke='none'
              label={{
                value: b.name,
                position: 'insideTopLeft',
                fill: 'var(--muted-foreground)',
                fontSize: 10,
              }}
            />
          ))}
          <XAxis
            dataKey='date'
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={value => formatDay(String(value), intl.locale)}
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
                labelFormatter={value => formatDay(String(value), intl.locale)}
              />
            }
          />
          <Area
            dataKey='completed'
            type='monotone'
            stroke='var(--color-completed)'
            strokeWidth={2}
            fill='url(#milestone-burnup-fill)'
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
      </div>
    </div>
  )
}
