'use client'

import { useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { GitBranch } from 'lucide-react'
import { useTaskLineage } from '../../hooks/useTaskLineage'
import type {
  LineageFragment,
  LineageOutcome,
  LineageTokens,
} from '../../types'

interface LineageTabProps {
  taskIdentifier: string
  enabled: boolean
}

// Fixed display order for outcome rollups, mirroring the CLI's OUTCOME_ORDER
// (cli/src/commands/task-lineage.ts) so the web + terminal audit views agree.
const OUTCOME_ORDER: LineageOutcome[] = [
  'MERGED',
  'REWORKED',
  'REJECTED',
  'UNKNOWN',
]

// Outcome badge styling via the semantic feedback tokens (LUM-258/290), same
// recipe as RiskBadge: -subtle tint + -border + accent dot, with the LABEL kept
// neutral (text-foreground/-muted) because the bright accents fail AA as text
// on their own subtle tint. UNKNOWN carries no color — typography only.
const OUTCOME_BADGE: Record<LineageOutcome, string> = {
  MERGED: 'bg-success-subtle border border-success-border text-foreground',
  REWORKED: 'bg-warning-subtle border border-warning-border text-foreground',
  REJECTED: 'bg-danger-subtle border border-danger-border text-foreground',
  UNKNOWN: 'border border-border text-muted-foreground',
}

// Token breakdown segments, in bar order. Colors are the LUM-290 chart palette
// (static literal classes so Tailwind emits them); cache-read is muted because
// it dominates the count (~90%) without representing ~90% of real spend.
const TOKEN_SEGMENTS: {
  key: keyof Pick<
    LineageTokens,
    'output' | 'input' | 'cacheCreation' | 'cacheRead'
  >
  bar: string
  dot: string
  labelId: string
  defaultLabel: string
  muted?: boolean
}[] = [
  {
    key: 'output',
    bar: 'bg-chart-1',
    dot: 'bg-chart-1',
    labelId: 'lineage.token.output',
    defaultLabel: 'output',
  },
  {
    key: 'input',
    bar: 'bg-chart-2',
    dot: 'bg-chart-2',
    labelId: 'lineage.token.input',
    defaultLabel: 'input',
  },
  {
    key: 'cacheCreation',
    bar: 'bg-chart-3',
    dot: 'bg-chart-3',
    labelId: 'lineage.token.cacheCreate',
    defaultLabel: 'cache-create',
  },
  {
    key: 'cacheRead',
    bar: 'bg-chart-4/40',
    dot: 'bg-chart-4/40',
    labelId: 'lineage.token.cacheRead',
    defaultLabel: 'cache-read',
    muted: true,
  },
]

const COLLAPSED_FRAGMENT_COUNT = 10

export function LineageTab({ taskIdentifier, enabled }: LineageTabProps) {
  const intl = useIntl()
  const { data, loading, error } = useTaskLineage({
    identifier: taskIdentifier,
    enabled,
  })
  const [showAllFragments, setShowAllFragments] = useState(false)

  const fragments = useMemo<LineageFragment[]>(
    () => (data ? data.groups.flatMap(g => g.fragments) : []),
    [data]
  )

  if (loading && !data) {
    return (
      <div className='py-8 text-center text-xs text-muted-foreground'>
        {intl.formatMessage({
          id: 'lineage.loading',
          defaultMessage: '加载中…',
        })}
      </div>
    )
  }

  if (error) {
    return <div className='py-8 text-center text-xs text-danger'>{error}</div>
  }

  if (!data || data.groups.length === 0) {
    return (
      <div className='py-12 flex flex-col items-center gap-2 text-muted-foreground'>
        <GitBranch className='size-6' />
        <p className='text-xs'>
          {intl.formatMessage({
            id: 'lineage.empty',
            defaultMessage: '此任务暂无 lineage 记录',
          })}
        </p>
        <p className='text-[11px] text-muted-foreground max-w-xs text-center'>
          {intl.formatMessage({
            id: 'lineage.emptyHint',
            defaultMessage:
              '当绑定它的 agent 会话消费 context 时，因果记录会自动生成在这里',
          })}
        </p>
      </div>
    )
  }

  const { totals } = data
  const { tokens } = totals

  const fmt = (n: number) =>
    intl.formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 })

  // "107 MERGED · 2 REWORKED" — fixed order, zeros omitted. Outcome enum values
  // are raw data (like fragmentType), mirrored from the API/CLI verbatim.
  const outcomeSummary = OUTCOME_ORDER.filter(o => totals.outcomes[o] > 0)
    .map(o => `${totals.outcomes[o]} ${o}`)
    .join(' · ')

  const visibleFragments = showAllFragments
    ? fragments
    : fragments.slice(0, COLLAPSED_FRAGMENT_COUNT)

  const chips = [
    { id: 'lineage.chip.sessionLevel', defaultMessage: '会话级' },
    { id: 'lineage.chip.live', defaultMessage: '实时' },
    { id: 'lineage.chip.notPerFragment', defaultMessage: '非每片段' },
    { id: 'lineage.chip.loopsNa', defaultMessage: 'loops n/a' },
  ]

  return (
    <div className='rounded-lg border border-border text-xs'>
      {/* Summary row */}
      <div className='px-3 py-2 border-b border-border text-muted-foreground'>
        {intl.formatMessage(
          {
            id: 'lineage.summary',
            defaultMessage:
              '{fragments, plural, one {# fragment} other {# fragments}} · {outcomes} · {sessions, plural, one {# session} other {# sessions}}',
          },
          {
            fragments: totals.fragmentCount,
            outcomes: outcomeSummary,
            sessions: totals.runCount,
          }
        )}
      </div>

      {/* Cost block (变体1: total as heading) */}
      <div className='px-3 py-3 border-b border-border'>
        <div className='text-[10px] uppercase tracking-wider text-muted-foreground/60'>
          {intl.formatMessage({
            id: 'lineage.cost.label',
            defaultMessage: 'Cost',
          })}
        </div>

        {tokens.total > 0 ? (
          <>
            <div className='text-2xl font-bold tabular-nums tracking-tight'>
              {fmt(tokens.total)}{' '}
              <span className='text-xs font-normal text-muted-foreground/60'>
                {intl.formatMessage({
                  id: 'lineage.cost.unit',
                  defaultMessage: 'tok',
                })}
              </span>
            </div>

            {/* Caliber chips — all static. `loops n/a` is hardcoded: the API
                coalesces a null loopCount to 0, so a numeric value would be a
                lie; we never render one (see LUM-281 follow-up). */}
            <div className='mt-1.5 flex flex-wrap gap-1'>
              {chips.map(c => (
                <span
                  key={c.id}
                  className='rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground'
                >
                  {intl.formatMessage({
                    id: c.id,
                    defaultMessage: c.defaultMessage,
                  })}
                </span>
              ))}
            </div>

            {/* Breakdown bar */}
            <div className='mt-2.5 flex h-2 overflow-hidden rounded-full'>
              {TOKEN_SEGMENTS.map(seg => {
                const value = tokens[seg.key]
                if (value <= 0) return null
                const pct = (value / tokens.total) * 100
                return (
                  <div
                    key={seg.key}
                    className={seg.bar}
                    style={{ width: `${pct}%` }}
                  />
                )
              })}
            </div>

            {/* Four detail rows */}
            <div className='mt-2 flex flex-col gap-0.5'>
              {TOKEN_SEGMENTS.map(seg => (
                <div
                  key={seg.key}
                  className={`flex items-center justify-between ${
                    seg.muted
                      ? 'text-muted-foreground/60'
                      : 'text-muted-foreground'
                  }`}
                >
                  <span className='flex items-center gap-1.5'>
                    <span
                      className={`size-1.5 rounded-full ${seg.dot}`}
                      aria-hidden
                    />
                    {intl.formatMessage({
                      id: seg.labelId,
                      defaultMessage: seg.defaultLabel,
                    })}
                  </span>
                  <span className='tabular-nums'>{fmt(tokens[seg.key])}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className='mt-1 text-muted-foreground'>
            {intl.formatMessage({
              id: 'lineage.cost.none',
              defaultMessage: '此条线索暂无采集到的成本',
            })}
          </div>
        )}
      </div>

      {/* Fragments list */}
      <div>
        {visibleFragments.map((f, i) => (
          <div
            key={`${f.fragmentType}-${f.fragmentId}-${i}`}
            className='flex items-center gap-2 px-3 py-1.5 border-t border-border/60 first:border-t-0 text-muted-foreground'
          >
            <span
              className={`rounded-sm px-1 text-[9px] font-bold ${OUTCOME_BADGE[f.outcome]}`}
            >
              {f.outcome}
            </span>
            <span className='truncate'>
              {f.fragmentType} — {f.sourceLabel}
            </span>
          </div>
        ))}

        {fragments.length > COLLAPSED_FRAGMENT_COUNT && (
          <button
            type='button'
            onClick={() => setShowAllFragments(v => !v)}
            className='w-full px-3 py-2 border-t border-border/60 text-left text-[11px] text-muted-foreground hover:text-foreground transition-colors'
          >
            {showAllFragments
              ? intl.formatMessage({
                  id: 'lineage.fragments.collapse',
                  defaultMessage: '收起',
                })
              : intl.formatMessage(
                  {
                    id: 'lineage.fragments.showAll',
                    defaultMessage: '展开全部 {count} 条',
                  },
                  { count: fragments.length }
                )}
          </button>
        )}
      </div>
    </div>
  )
}
