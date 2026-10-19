'use client'

import { useState, type ReactNode } from 'react'
import { useIntl, type IntlShape } from 'react-intl'
import { ChevronRight } from 'lucide-react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import type { ModelCost } from '../types'
import { IN_FLIGHT_MODEL } from '@/types/model-cost'
import { fmtCompact } from './AgentRunTimeline/model-cost-format'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export interface CostChip {
  id: string
  defaultMessage: string
}

type SegmentKey = keyof Pick<
  ModelCost,
  'output' | 'input' | 'cacheCreation' | 'cacheRead'
>

// Token breakdown segments in bar order. Static literal classes so Tailwind
// emits them; cache-read muted (~88% of count, not ~88% of spend).
const SEGMENTS: {
  key: SegmentKey
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
  collapsibleDetails = false,
  rowHeader,
}: {
  m: ModelCost
  multi: boolean
  variant: 'full' | 'compact'
  intl: IntlShape
  collapsibleDetails?: boolean
  rowHeader?: ((m: ModelCost) => ReactNode) | undefined
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const fmt = (n: number) => fmtCompact(intl, n)
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

  const nameNode = rowHeader ? (
    rowHeader(m)
  ) : m.model === IN_FLIGHT_MODEL ? (
    // Mid-turn burn not yet settled into a per-model split (LUM-345);
    // muted because it's a state, not a model name.
    <span className='text-caption font-semibold text-muted-foreground'>
      {intl.formatMessage({
        id: 'tokenCost.inFlight',
        defaultMessage: 'in progress',
      })}
    </span>
  ) : m.model ? (
    <span className='text-caption font-semibold'>{m.model}</span>
  ) : null

  const totalNode = (
    <span className={`${headlineSize} ml-auto tabular-nums`}>
      {fmt(m.total)}{' '}
      <span className='text-caption font-normal text-muted-foreground/60'>
        {unit}
      </span>
    </span>
  )

  const headerRow = collapsibleDetails ? (
    <CollapsibleTrigger
      data-testid='model-detail-toggle'
      className='flex w-full items-center gap-2 rounded-md -mx-1 px-1 py-0.5 hover:bg-muted/60'
    >
      <ChevronRight
        className='size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/collapsible:rotate-90'
        aria-hidden
      />
      {nameNode}
      {totalNode}
    </CollapsibleTrigger>
  ) : (
    <div className='flex items-center gap-2'>
      {nameNode}
      {totalNode}
    </div>
  )

  const bar = (
    <div
      data-testid='cost-bar'
      className='mt-2 flex h-2 overflow-hidden rounded-full'
    >
      {SEGMENTS.map(seg => {
        // The flat fields include the in-flight share; the colored segment
        // shows only the settled part — the provisional remainder renders
        // as one striped trailing segment after the loop.
        const value = m[seg.key] - (m.inFlight?.[seg.key] ?? 0)
        if (value <= 0) return null
        return (
          <div
            key={seg.key}
            className={seg.bar}
            style={{ width: `${(value / m.total) * 100}%` }}
          />
        )
      })}
      {m.inFlight && m.inFlight.total > 0 && (
        <div
          data-testid='in-flight-segment'
          className='animate-pulse'
          style={{
            width: `${(m.inFlight.total / m.total) * 100}%`,
            backgroundImage:
              'repeating-linear-gradient(45deg, color-mix(in oklch, var(--muted-foreground) 40%, transparent) 0 3px, transparent 3px 6px)',
          }}
        />
      )}
    </div>
  )

  const detailRows = (
    <div className='mt-2 flex flex-col gap-0.5 text-caption'>
      {SEGMENTS.map(seg => {
        const label = intl.formatMessage({
          id: seg.labelId,
          defaultMessage: seg.defaultLabel,
        })
        const tone = seg.muted
          ? 'text-muted-foreground/60'
          : 'text-muted-foreground'
        return (
          <div
            key={seg.key}
            className={`flex items-center justify-between ${tone}`}
          >
            <span className='flex items-center gap-1.5'>
              <span
                className={`size-1.5 rounded-full ${seg.dot}`}
                aria-hidden
              />
              {label}
            </span>
            <span className='tabular-nums'>{fmt(m[seg.key])}</span>
          </div>
        )
      })}
    </div>
  )

  return (
    <Collapsible
      open={!collapsibleDetails || detailsOpen}
      onOpenChange={setDetailsOpen}
      className='mt-3 first:mt-0'
    >
      {headerRow}
      {collapsibleDetails && !detailsOpen ? (
        <Tooltip>
          <TooltipTrigger asChild>{bar}</TooltipTrigger>
          <TooltipContent className='bg-popover text-popover-foreground border'>
            {SEGMENTS.map(seg => (
              <div
                key={seg.key}
                className='flex items-center justify-between gap-4'
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
          </TooltipContent>
        </Tooltip>
      ) : (
        bar
      )}
      {m.inFlight && m.model !== IN_FLIGHT_MODEL && (
        <div className='mt-1 flex items-center gap-1 text-caption text-muted-foreground'>
          <span
            className='size-1.5 animate-pulse rounded-full bg-muted-foreground/60'
            aria-hidden
          />
          {intl.formatMessage(
            {
              id: 'tokenCost.inFlightShare',
              defaultMessage: 'incl. {n} in flight',
            },
            { n: fmt(m.inFlight.total) }
          )}
        </div>
      )}
      <CollapsibleContent>{detailRows}</CollapsibleContent>
    </Collapsible>
  )
}

interface TokenCostBreakdownProps {
  models: ModelCost[]
  /**
   * Real loop count → "N loops" chip. null/undefined → no chip at all
   * (LUM-313: a "loops n/a" pill next to the header's turn count read as a
   * contradiction, so absence is now silent rather than labelled).
   */
  loopCount?: number | null
  variant: 'full' | 'compact'
  /** Extra caliber chips (e.g. lineage's 会话级/实时). */
  chips?: CostChip[]
  /**
   * Render the "Token usage" heading (default). The run-tab summary card
   * passes false because its disclosure header already carries the title.
   */
  showTitle?: boolean
  /**
   * When true, each model's title row becomes a per-model toggle; the
   * segmented bar stays always-visible while the four detail rows hide until
   * expanded. A bar hover tooltip lists the four values while collapsed.
   */
  collapsibleDetails?: boolean
  /**
   * Override the model-name span with a custom node (e.g. avatar + name row).
   * Called once per ModelGroup with the ModelCost for that group.
   */
  rowHeader?: (m: ModelCost) => ReactNode
}

export function TokenCostBreakdown({
  models,
  loopCount,
  variant,
  chips,
  showTitle = true,
  collapsibleDetails = false,
  rowHeader,
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

  // Only label a real loop count; absence is silent (LUM-313 — see loopCount).
  const loopChip =
    typeof loopCount === 'number'
      ? intl.formatMessage(
          {
            id: 'tokenCost.loops',
            defaultMessage: '{n, plural, one {# loop} other {# loops}}',
          },
          { n: loopCount }
        )
      : null

  const hasFooter = !!loopChip || !!chips?.length

  return (
    <div className={variant === 'full' ? 'px-3 py-3' : ''}>
      {showTitle && (
        <div className='mb-2 text-caption text-muted-foreground'>
          {intl.formatMessage({
            id: 'tokenCost.label',
            defaultMessage: 'Token usage',
          })}
        </div>
      )}
      {models.map(m => (
        <ModelGroup
          key={m.model || 'single'}
          m={m}
          multi={multi}
          variant={variant}
          intl={intl}
          collapsibleDetails={collapsibleDetails}
          rowHeader={rowHeader}
        />
      ))}
      {hasFooter && (
        <div className='mt-2 flex flex-wrap gap-1'>
          {loopChip && (
            <span className='rounded-full border border-border px-1.5 py-px text-caption text-muted-foreground'>
              {loopChip}
            </span>
          )}
          {chips?.map(c => (
            <span
              key={c.id}
              className='rounded-full border border-border px-1.5 py-px text-caption text-muted-foreground'
            >
              {intl.formatMessage({
                id: c.id,
                defaultMessage: c.defaultMessage,
              })}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
