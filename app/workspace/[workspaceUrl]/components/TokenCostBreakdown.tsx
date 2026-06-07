'use client'

import { useIntl, type IntlShape } from 'react-intl'
import type { ModelCost } from '../types'

export interface CostChip {
  id: string
  defaultMessage: string
}

interface TokenCostBreakdownProps {
  models: ModelCost[]
  /** Real loop count → "N loops"; null/undefined → "loops n/a" chip. */
  loopCount?: number | null
  variant: 'full' | 'compact'
  /** Extra caliber chips (e.g. lineage's 会话级/实时). */
  chips?: CostChip[]
}

// Token breakdown segments in bar order. Static literal classes so Tailwind
// emits them; cache-read muted (~88% of count, not ~88% of spend).
const SEGMENTS: {
  key: keyof Pick<ModelCost, 'output' | 'input' | 'cacheCreation' | 'cacheRead'>
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
    labelId: 'tokenCost.output',
    defaultLabel: 'output',
  },
  {
    key: 'input',
    bar: 'bg-chart-2',
    dot: 'bg-chart-2',
    labelId: 'tokenCost.input',
    defaultLabel: 'input',
  },
  {
    key: 'cacheCreation',
    bar: 'bg-chart-3',
    dot: 'bg-chart-3',
    labelId: 'tokenCost.cacheCreate',
    defaultLabel: 'cache-create',
  },
  {
    key: 'cacheRead',
    bar: 'bg-chart-4/40',
    dot: 'bg-chart-4/40',
    labelId: 'tokenCost.cacheRead',
    defaultLabel: 'cache-read',
    muted: true,
  },
]

// One per-model block: total heading (sized by variant — see headlineSize),
// the proportional bar, and the four detail rows. Hoisted to module
// scope so it keeps a stable component identity across renders (defining it
// inside the parent would remount the subtree on every render).
function ModelGroup({
  m,
  multi,
  variant,
  intl,
}: {
  m: ModelCost
  multi: boolean
  variant: 'full' | 'compact'
  intl: IntlShape
}) {
  const fmt = (n: number) =>
    intl.formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 })
  const unit = intl.formatMessage({
    id: 'tokenCost.unit',
    defaultMessage: 'tok',
  })

  // Headline size on the semantic tier scale: the summary (full) total is the
  // focal number; a single run's (compact) total is secondary so it sits a tier
  // down and reads as detail rather than re-stating the summary.
  const headlineSize = multi
    ? 'text-body-strong'
    : variant === 'full'
      ? 'text-heading'
      : 'text-title'

  return (
    <div className='py-2 first:pt-0 border-t border-border/60 first:border-t-0'>
      <div className='flex items-center gap-2'>
        {m.model && (
          <span className='text-caption font-semibold'>{m.model}</span>
        )}
        <span className={`${headlineSize} ml-auto tabular-nums`}>
          {fmt(m.total)}{' '}
          <span className='text-[10px] font-normal text-muted-foreground/60'>
            {unit}
          </span>
        </span>
      </div>
      <div className='mt-2 flex h-2 overflow-hidden rounded-full'>
        {SEGMENTS.map(seg => {
          const value = m[seg.key]
          if (value <= 0) return null
          return (
            <div
              key={seg.key}
              className={seg.bar}
              style={{ width: `${(value / m.total) * 100}%` }}
            />
          )
        })}
      </div>
      <div className='mt-2 flex flex-col gap-0.5 text-caption'>
        {SEGMENTS.map(seg => (
          <div
            key={seg.key}
            className={`flex items-center justify-between ${seg.muted ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}
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
            <span className='tabular-nums'>{fmt(m[seg.key])}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TokenCostBreakdown({
  models,
  loopCount,
  variant,
  chips,
}: TokenCostBreakdownProps) {
  const intl = useIntl()

  if (models.length === 0) {
    return (
      <div className='text-muted-foreground'>
        {intl.formatMessage({
          id: 'tokenCost.none',
          defaultMessage: 'No captured cost on this trail',
        })}
      </div>
    )
  }

  const multi = models.length > 1

  const loopChip =
    typeof loopCount === 'number'
      ? intl.formatMessage(
          {
            id: 'tokenCost.loops',
            defaultMessage: '{n, plural, one {# loop} other {# loops}}',
          },
          { n: loopCount }
        )
      : intl.formatMessage({
          id: 'tokenCost.loopsNa',
          defaultMessage: 'loops n/a',
        })

  return (
    <div className={variant === 'full' ? 'px-3 py-3' : ''}>
      <div className='text-[10px] uppercase tracking-wider text-muted-foreground/60'>
        {intl.formatMessage({
          id: 'lineage.cost.label',
          defaultMessage: 'Cost',
        })}
      </div>
      {models.map(m => (
        <ModelGroup
          key={m.model || 'single'}
          m={m}
          multi={multi}
          variant={variant}
          intl={intl}
        />
      ))}
      <div className='mt-2 flex flex-wrap gap-1'>
        <span className='rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground'>
          {loopChip}
        </span>
        {chips?.map(c => (
          <span
            key={c.id}
            className='rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground'
          >
            {intl.formatMessage({ id: c.id, defaultMessage: c.defaultMessage })}
          </span>
        ))}
        {multi && (
          <span className='rounded-full border border-warning-border bg-warning-subtle px-1.5 py-px text-[10px] text-foreground'>
            {intl.formatMessage({
              id: 'tokenCost.mixedNoTotal',
              defaultMessage: 'models not price-comparable · no total',
            })}
          </span>
        )}
      </div>
    </div>
  )
}
