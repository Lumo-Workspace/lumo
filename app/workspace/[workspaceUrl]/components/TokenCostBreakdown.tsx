'use client'

import { useState } from 'react'
import { useIntl, type IntlShape } from 'react-intl'
import { ChevronRight } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { AgentRunMemberStat, ModelCost } from '../types'
import { IN_FLIGHT_MODEL } from '@/types/model-cost'
import { initialsOf } from './initials'

export interface CostChip {
  id: string
  defaultMessage: string
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
   * Per-person spend (LUM-308). When two or more members contributed to a
   * given token kind, that detail row (output/input/…) becomes a disclosure
   * that expands in-place to the per-member split. Rows with a single
   * contributor stay plain — expanding them just restated the line verbatim
   * (LUM-313). Rows are collapsed by default, so the aggregate view is
   * unchanged. Omit entirely to render plain, non-expandable rows (the
   * per-run / lineage usage).
   */
  perMember?: AgentRunMemberStat[]
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

export interface MemberCell {
  workspaceMemberId: string
  name: string
  imageUrl: string
  value: number
}

/**
 * Per-member values for one (model, token-kind) cell, biggest first, with
 * zero-contribution members dropped. Pure — the sum of `value` equals the
 * cell's aggregate as long as every contributing run is attributed to a
 * member (orphan / member-less runs add to neither side, preserving the
 * invariant the UI relies on).
 */
export function memberBreakdownFor(
  perMember: AgentRunMemberStat[],
  model: string,
  key: SegmentKey
): MemberCell[] {
  return perMember
    .map(mem => {
      const mc = mem.byModel.find(b => b.model === model)
      return {
        workspaceMemberId: mem.workspaceMemberId,
        name: mem.name,
        imageUrl: mem.imageUrl,
        value: mc ? mc[key] : 0,
      }
    })
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value)
}

// One per-model block: total heading (sized by variant — see headlineSize),
// the proportional bar, and the four detail rows. Hoisted to module
// scope so it keeps a stable component identity across renders (defining it
// inside the parent would remount the subtree on every render).
function ModelGroup({
  m,
  multi,
  variant,
  intl,
  perMember,
}: {
  m: ModelCost
  multi: boolean
  variant: 'full' | 'compact'
  intl: IntlShape
  /** Present on the aggregate card; a row expands only where 2+ members split it. */
  perMember?: AgentRunMemberStat[] | undefined
}) {
  // Which detail rows are currently expanded (by segment key).
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const toggle = (key: string) =>
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const fmt = (n: number) =>
    intl.formatNumber(n, { notation: 'compact', maximumFractionDigits: 1 })
  const unit = intl.formatMessage({
    id: 'tokenCost.unit',
    defaultMessage: 'tok',
  })

  const expandable = !!perMember && perMember.length >= 1

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
        {m.model === IN_FLIGHT_MODEL ? (
          // Mid-turn burn not yet settled into a per-model split (LUM-345);
          // muted because it's a state, not a model name.
          <span className='text-caption font-semibold text-muted-foreground'>
            {intl.formatMessage({
              id: 'tokenCost.inFlight',
              defaultMessage: 'in progress',
            })}
          </span>
        ) : (
          m.model && (
            <span className='text-caption font-semibold'>{m.model}</span>
          )
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
        {SEGMENTS.map(seg => {
          const label = intl.formatMessage({
            id: seg.labelId,
            defaultMessage: seg.defaultLabel,
          })
          const rows = expandable
            ? memberBreakdownFor(perMember!, m.model, seg.key)
            : []
          // Only expand where the split is informative: 2+ contributors. A
          // single contributor's row equals the line verbatim (its bar would
          // always be 100% full), so it stays a plain row (LUM-313).
          const canExpand = rows.length > 1
          const isOpen = open.has(seg.key)
          const tone = seg.muted
            ? 'text-muted-foreground/60'
            : 'text-muted-foreground'
          const rowInner = (
            <>
              <span className='flex items-center gap-1.5'>
                {canExpand && (
                  <ChevronRight
                    className={`size-3 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                    aria-hidden
                  />
                )}
                <span
                  className={`size-1.5 rounded-full ${seg.dot}`}
                  aria-hidden
                />
                {label}
              </span>
              <span className='tabular-nums'>{fmt(m[seg.key])}</span>
            </>
          )

          return (
            <div key={seg.key}>
              {canExpand ? (
                <button
                  type='button'
                  onClick={() => toggle(seg.key)}
                  aria-expanded={isOpen}
                  data-testid={`cost-line-${seg.key}`}
                  className={`flex w-full items-center justify-between rounded-md -mx-1 px-1 py-0.5 hover:bg-muted/60 ${tone}`}
                >
                  {rowInner}
                </button>
              ) : (
                <div className={`flex items-center justify-between ${tone}`}>
                  {rowInner}
                </div>
              )}
              {canExpand && isOpen && (
                <div
                  className='mt-0.5 mb-1 flex flex-col gap-1 pl-5'
                  data-testid={`cost-breakdown-${seg.key}`}
                >
                  {rows.map(r => (
                    <div
                      key={r.workspaceMemberId}
                      className='flex items-center gap-2'
                    >
                      <Avatar className='size-4 shrink-0'>
                        <AvatarImage src={r.imageUrl || undefined} />
                        <AvatarFallback className='text-[8px]'>
                          {initialsOf(r.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className='w-20 truncate text-foreground'>
                        {r.name}
                      </span>
                      <span className='h-1.5 flex-1 overflow-hidden rounded-full bg-muted'>
                        <span
                          className={`block h-full rounded-full ${seg.dot}`}
                          style={{ width: `${(r.value / m[seg.key]) * 100}%` }}
                        />
                      </span>
                      <span className='w-14 text-right tabular-nums text-muted-foreground'>
                        {fmt(r.value)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TokenCostBreakdown({
  models,
  loopCount,
  variant,
  chips,
  perMember,
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

  const hasFooter = !!loopChip || !!chips?.length || multi

  return (
    <div className={variant === 'full' ? 'px-3 py-3' : ''}>
      <div className='text-[10px] uppercase tracking-wider text-muted-foreground/60'>
        {intl.formatMessage({
          id: 'tokenCost.label',
          defaultMessage: 'Token usage',
        })}
      </div>
      {models.map(m => (
        <ModelGroup
          key={m.model || 'single'}
          m={m}
          multi={multi}
          variant={variant}
          intl={intl}
          perMember={perMember}
        />
      ))}
      {hasFooter && (
        <div className='mt-2 flex flex-wrap gap-1'>
          {loopChip && (
            <span className='rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground'>
              {loopChip}
            </span>
          )}
          {chips?.map(c => (
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
          {multi && (
            <span className='rounded-full border border-warning-border bg-warning-subtle px-1.5 py-px text-[10px] text-foreground'>
              {intl.formatMessage({
                id: 'tokenCost.mixedNoTotal',
                defaultMessage: 'models not price-comparable · no total',
              })}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
