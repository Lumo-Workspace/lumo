'use client'

import { useState } from 'react'
import { useIntl } from 'react-intl'
import { Card } from '@/components/ui/card'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ApiMilestone } from '@/lib/api-client/milestones'
import { formatDurationSec } from '@/lib/datetime/duration'

// Same compact notation the CLI and the task-level cost card use (LUM-560),
// so one number reads identically across surfaces.
const TOKEN_FMT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
})
const fmtTokens = (n: number) => TOKEN_FMT.format(n)

type ModelUsageRow = NonNullable<
  NonNullable<ApiMilestone['costRollup']>['models']
>[number]

/** Token-kind segments in bar order — the chart-1..4 encoding shared with the
 * task-level TokenCostBreakdown. Static literal classes so Tailwind emits them. */
const MODEL_SEGMENTS: {
  key: 'output' | 'input' | 'cacheCreation' | 'cacheRead'
  bar: string
  labelId: string
}[] = [
  { key: 'output', bar: 'bg-chart-1', labelId: 'tokenCost.output' },
  { key: 'input', bar: 'bg-chart-2', labelId: 'tokenCost.input' },
  { key: 'cacheCreation', bar: 'bg-chart-3', labelId: 'tokenCost.cacheCreate' },
  { key: 'cacheRead', bar: 'bg-chart-4/40', labelId: 'tokenCost.cacheRead' },
]

/** `+adds / −dels`, colored the GitHub way (additions chart-2, deletions danger).
 * Only ever rendered with MEASURED sums — an unsynced state reads as text. */
function VolumeText({
  additions,
  deletions,
}: {
  additions: number
  deletions: number
}) {
  return (
    <span data-testid='change-volume' className='tabular-nums'>
      <span className='text-[var(--chart-2)]'>
        +{TOKEN_FMT.format(additions)}
      </span>
      <span className='font-normal text-muted-foreground'>/</span>
      <span className='text-danger-text'>−{TOKEN_FMT.format(deletions)}</span>
    </span>
  )
}

/** Per-model split of the measured spend; renders nothing without model data. */
function ModelUsageBreakdown({
  models,
  unattributedTokens,
  showLegend = false,
}: {
  models: ModelUsageRow[] | undefined
  unattributedTokens?: number | undefined
  showLegend?: boolean
}) {
  const intl = useIntl()
  if (!models || models.length === 0) return null
  return (
    <div className='space-y-2'>
      {models.slice(0, 3).map(m => (
        <div key={m.model} data-testid='model-usage-row'>
          <div className='flex items-baseline justify-between gap-2 text-caption'>
            <span className='min-w-0 truncate font-semibold'>{m.model}</span>
            <span className='shrink-0 tabular-nums text-muted-foreground'>
              {fmtTokens(m.total)}
            </span>
          </div>
          <div
            aria-hidden='true'
            className='mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted'
          >
            {MODEL_SEGMENTS.map(seg => {
              const value = m[seg.key]
              if (value <= 0 || m.total <= 0) return null
              return (
                <span
                  key={seg.key}
                  className={seg.bar}
                  style={{ width: `${(value / m.total) * 100}%` }}
                />
              )
            })}
          </div>
        </div>
      ))}
      {models.length > 3 && (
        <p className='text-caption text-muted-foreground'>
          {intl.formatMessage(
            { id: 'milestone.costTrend.moreModels' },
            {
              count: models.length - 3,
              total: fmtTokens(
                models.slice(3).reduce((sum, m) => sum + m.total, 0)
              ),
            }
          )}
        </p>
      )}
      {(unattributedTokens ?? 0) > 0 && (
        <p className='text-caption text-muted-foreground'>
          {intl.formatMessage(
            { id: 'milestone.costTrend.modelUnattributed' },
            { total: fmtTokens(unattributedTokens ?? 0) }
          )}
        </p>
      )}
      {showLegend && (
        <div className='flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground'>
          {MODEL_SEGMENTS.map(seg => (
            <span key={seg.key} className='flex items-center gap-1'>
              <span
                className={`h-1.5 w-1.5 rounded-full ${seg.bar}`}
                aria-hidden='true'
              />
              {intl.formatMessage({ id: seg.labelId })}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

type TaskRow = NonNullable<
  NonNullable<ApiMilestone['deliveryStats']>['perTask']
>['rows'][number]

function ByTaskHeading() {
  const intl = useIntl()
  return (
    <p className='text-caption font-semibold uppercase tracking-wider text-muted-foreground'>
      {intl.formatMessage({ id: 'milestone.metrics.byTask' })}
    </p>
  )
}

/** An older server sends no perTask block, and a milestone can genuinely have
 * no task carrying this signal — either way, say so rather than show zeros. */
function NoTaskRows() {
  const intl = useIntl()
  return (
    <p className='text-body text-muted-foreground'>
      {intl.formatMessage({ id: 'milestone.costTrend.notMeasured' })}
    </p>
  )
}

/** `LUM-497 · title` — the row identity shared by all three BY TASK panels. */
function TaskRowLabel({ row }: { row: TaskRow }) {
  return (
    <>
      <span className='w-16 shrink-0 truncate font-mono text-caption text-muted-foreground'>
        {row.ref ?? row.taskId.slice(0, 8)}
      </span>
      <span className='min-w-0 flex-1 truncate' title={row.title ?? undefined}>
        {row.title ?? ''}
      </span>
    </>
  )
}

/** LUM-644 advisory burn-vs-budget line; nothing without a budget. */
function TokenBudgetLine({ budget }: { budget: ApiMilestone['budget'] }) {
  const intl = useIntl()
  if (!budget) return null
  if (budget.usedRatio === null) {
    return (
      <p
        data-testid='token-budget-line'
        className='text-caption text-muted-foreground'
      >
        {intl.formatMessage(
          { id: 'milestone.costTrend.budgetUnmeasured' },
          { budget: fmtTokens(budget.tokenBudget) }
        )}
      </p>
    )
  }
  const pct = Math.round(budget.usedRatio * 100)
  return (
    <div data-testid='token-budget-line'>
      <p className='text-caption text-muted-foreground'>
        {intl.formatMessage(
          { id: 'milestone.costTrend.budgetUsage' },
          { percent: pct, budget: fmtTokens(budget.tokenBudget) }
        )}
      </p>
      <div
        aria-hidden='true'
        className='mt-1 flex h-1 overflow-hidden rounded-full bg-muted'
      >
        <span
          className={budget.exceeded ? 'bg-[var(--danger)]' : 'bg-chart-1'}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      {budget.exceeded && budget.overBy !== null && (
        <p
          data-testid='token-budget-over'
          className='mt-1 text-caption font-semibold text-danger-text'
        >
          {intl.formatMessage(
            { id: 'milestone.costTrend.budgetOver' },
            { over: fmtTokens(budget.overBy) }
          )}
        </p>
      )}
    </div>
  )
}

type MetricKey = 'tokens' | 'time' | 'prs'

interface MilestoneMetricStripProps {
  costRollup: ApiMilestone['costRollup']
  /** LUM-644 advisory budget block; absent = no budget set. */
  budget?: ApiMilestone['budget']
  deliveryStats: ApiMilestone['deliveryStats']
}

/**
 * The single-page metric strip: three chips (tokens · active time · merged
 * PRs) that expand into the detail the payload actually carries — the
 * per-model split for tokens, the per-member rows for active time, the
 * rework/change-volume counts for PRs.
 *
 * Honest by construction: an unmeasured total reads an explicit "not
 * measured" instead of implying a clean 0, a milestone with no PR records
 * says so, and an unsynced diff never renders +0/−0.
 */
export function MilestoneMetricStrip({
  costRollup,
  budget,
  deliveryStats,
}: MilestoneMetricStripProps) {
  const intl = useIntl()
  const [open, setOpen] = useState<MetricKey | null>(null)

  // Without any enrichment there is nothing honest to say — render nothing
  // rather than a row of placeholder chips.
  if (!costRollup && !deliveryStats) return null

  // Spend is only honest when something was actually measured: a milestone
  // with zero measured tasks would otherwise read a clean 0s / 0 tokens.
  const spendMeasured = (costRollup?.measuredTasks ?? 0) > 0
  const notMeasured = (
    <span className='font-normal text-muted-foreground'>
      {intl.formatMessage({ id: 'milestone.costTrend.notMeasured' })}
    </span>
  )

  // BY TASK rows, one ordering per panel — each panel sorts by the number it
  // renders, so the top row is always the one the reader came for.
  const taskRows = deliveryStats?.perTask?.rows ?? []
  const tokenRows = taskRows
    .filter(r => r.tokenCost !== null)
    .sort((a, b) => (b.tokenCost ?? 0) - (a.tokenCost ?? 0))
  const timeRows = taskRows
    .filter(r => r.activeTimeSec > 0)
    .sort((a, b) => b.activeTimeSec - a.activeTimeSec)
  const prRows = taskRows
    .filter(r => r.prCount > 0)
    .sort((a, b) => b.prCount - a.prCount)
  const maxActive = timeRows.reduce(
    (max, r) => Math.max(max, r.activeTimeSec),
    0
  )

  const chip = (key: MetricKey, labelId: string, value: React.ReactNode) => {
    const isOpen = open === key
    return (
      <button
        type='button'
        onClick={() => setOpen(prev => (prev === key ? null : key))}
        aria-expanded={isOpen}
        className={cn(
          'flex items-center gap-2 rounded-md border px-3 py-1.5 text-body transition-colors',
          isOpen
            ? 'border-ring bg-muted'
            : 'border-border bg-card hover:bg-muted/50'
        )}
      >
        <span className='text-muted-foreground'>
          {intl.formatMessage({ id: labelId })}
        </span>
        <span className='font-semibold tabular-nums'>{value}</span>
        {isOpen ? (
          <ChevronUp className='size-3 text-muted-foreground' />
        ) : (
          <ChevronDown className='size-3 text-muted-foreground' />
        )}
      </button>
    )
  }

  return (
    <section
      aria-label={intl.formatMessage({ id: 'milestone.metrics.label' })}
      className='mt-6'
    >
      <div className='flex flex-wrap items-center gap-2'>
        {costRollup &&
          chip(
            'tokens',
            'milestone.costTrend.tokens',
            costRollup.tokenCost === null
              ? notMeasured
              : fmtTokens(costRollup.tokenCost)
          )}
        {costRollup &&
          chip(
            'time',
            'milestone.costTrend.activeTime',
            spendMeasured
              ? formatDurationSec(intl, costRollup.activeTimeSec)
              : notMeasured
          )}
        {deliveryStats &&
          chip(
            'prs',
            'milestone.deliveryStats.mergedPrs',
            deliveryStats.pr.linkedTaskCount === 0 ? (
              <span className='font-normal text-muted-foreground'>
                {intl.formatMessage({
                  id: 'milestone.deliveryStats.noPrRecords',
                })}
              </span>
            ) : (
              deliveryStats.pr.mergedPrCount
            )
          )}
      </div>

      {open !== null && (
        <Card className='mt-2 max-w-2xl space-y-3 p-4'>
          {open === 'tokens' && costRollup && (
            <>
              <ByTaskHeading />
              {tokenRows.length === 0 ? (
                <NoTaskRows />
              ) : (
                <ul className='space-y-3'>
                  {tokenRows.map(row => (
                    <li key={row.taskId} data-testid='metric-task-row'>
                      <div className='flex items-baseline gap-2 text-caption'>
                        <TaskRowLabel row={row} />
                        <span className='shrink-0 font-semibold tabular-nums'>
                          {fmtTokens(row.tokenCost ?? 0)}
                        </span>
                      </div>
                      {/* 4rem ref column + the row's 0.5rem gap — the model rows line
                          up with the task TITLE, not with the id. */}
                      <div className='mt-1.5 pl-18'>
                        <ModelUsageBreakdown
                          models={row.models}
                          unattributedTokens={row.modelUnattributedTokens}
                        />
                      </div>
                    </li>
                  ))}
                  <li className='flex flex-wrap gap-x-3 gap-y-1 pl-18 text-caption text-muted-foreground'>
                    {MODEL_SEGMENTS.map(seg => (
                      <span key={seg.key} className='flex items-center gap-1'>
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${seg.bar}`}
                          aria-hidden='true'
                        />
                        {intl.formatMessage({ id: seg.labelId })}
                      </span>
                    ))}
                  </li>
                </ul>
              )}
              <p className='text-caption text-muted-foreground'>
                {intl.formatMessage(
                  { id: 'milestone.costTrend.coverage' },
                  {
                    measured: costRollup.measuredTasks,
                    total: costRollup.totalTasks,
                  }
                )}
              </p>
              <TokenBudgetLine budget={budget ?? null} />
            </>
          )}

          {open === 'time' && (
            <>
              <ByTaskHeading />
              {timeRows.length === 0 ? (
                <NoTaskRows />
              ) : (
                <ul className='space-y-2'>
                  {timeRows.map(row => (
                    <li
                      key={row.taskId}
                      data-testid='metric-task-row'
                      className='flex items-center gap-2 text-caption'
                    >
                      <TaskRowLabel row={row} />
                      <div
                        aria-hidden='true'
                        className='h-1 w-24 shrink-0 overflow-hidden rounded-full bg-muted'
                      >
                        <span
                          className='block h-full bg-chart-1'
                          style={{
                            width: `${maxActive > 0 ? (row.activeTimeSec / maxActive) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <span className='w-16 shrink-0 text-right font-semibold tabular-nums'>
                        {formatDurationSec(intl, row.activeTimeSec)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className='text-caption text-muted-foreground'>
                {intl.formatMessage({
                  id: 'milestone.costTrend.activeTimeNote',
                })}
              </p>
            </>
          )}

          {open === 'prs' && deliveryStats && (
            <>
              <ByTaskHeading />
              {prRows.length === 0 ? (
                <NoTaskRows />
              ) : (
                <ul className='space-y-2'>
                  {prRows.map(row => (
                    <li
                      key={row.taskId}
                      data-testid='metric-task-row'
                      className='flex items-center gap-2 text-caption'
                    >
                      <TaskRowLabel row={row} />
                      {row.multiPr && (
                        <span
                          data-testid='multi-pr-chip'
                          className='shrink-0 rounded-full border border-[var(--warning-border)] bg-[var(--warning-subtle)] px-2 py-0.5 font-semibold'
                        >
                          {intl.formatMessage({
                            id: 'milestone.metrics.multiPr',
                          })}
                        </span>
                      )}
                      <span className='w-14 shrink-0 text-right font-semibold tabular-nums'>
                        {intl.formatMessage(
                          { id: 'milestone.memberDelivery.prCount' },
                          { count: row.prCount }
                        )}
                      </span>
                      <span className='w-24 shrink-0 text-right font-semibold'>
                        {row.changeVolume ? (
                          <VolumeText
                            additions={row.changeVolume.additions}
                            deletions={row.changeVolume.deletions}
                          />
                        ) : (
                          <span className='font-normal text-muted-foreground'>
                            {intl.formatMessage({
                              id: 'milestone.changeVolume.memberNone',
                            })}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      )}
    </section>
  )
}
