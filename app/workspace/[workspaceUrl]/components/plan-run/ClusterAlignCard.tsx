'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight, Star } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import {
  ALIGN_VERDICTS,
  MAX_STARRED,
  type AlignVerdict,
} from '@/lib/plan-run/gate-b'

/** One idea shown inside the card's expandable list. */
export interface AlignCardIdea {
  id: string
  statement: string
}

export interface ClusterCardState {
  clusterId: string
  verdict: AlignVerdict
  rationale: string
  customizationTrap: boolean
  starred: boolean
  /** Cluster identity as confirmed at gate A ('' when unresolvable). */
  name: string
  thrust: string
  ideas: AlignCardIdea[]
  /** Ids of the ideas still checked — the ones entering this plan (LUM-688). */
  keptIdeaIds: string[]
}

interface Props {
  cluster: ClusterCardState
  /** Star is disabled (cap reached) unless THIS card is already starred. */
  starCapReached: boolean
  onVerdictChange: (verdict: AlignVerdict) => void
  onRationaleChange: (rationale: string) => void
  onToggleStar: () => void
  onToggleIdea: (ideaId: string) => void
}

const VERDICT_LABEL: Record<AlignVerdict, string> = {
  ALIGNED: 'planGate.verdict.aligned',
  UNRELATED: 'planGate.verdict.unrelated',
  CONFLICT: 'planGate.verdict.conflict',
}

/** The layout reads fitToContent needs — kept structural so it stays testable. */
type Fittable = {
  scrollHeight: number
  clientHeight: number
  offsetHeight: number
  style: Pick<CSSStyleDeclaration, 'height'>
}

/**
 * Grow a textarea to fit its content, so a long rationale is read in full
 * rather than through a 2-row peephole (LUM-685 — the fixed-height box still
 * clipped at narrow widths). Resetting to 'auto' first lets it shrink back.
 *
 * `scrollHeight` covers content + padding but NOT the border, while Tailwind's
 * `box-sizing: border-box` makes `height` include it — so assigning scrollHeight
 * verbatim leaves the box a border short and still clipping. `offsetHeight -
 * clientHeight` is that border (plus any horizontal scrollbar), added back.
 *
 * jsdom has no layout engine and reports 0 for all three; skip rather than
 * collapse the box to nothing.
 */
export function fitToContent(el: Fittable | null): void {
  if (!el) return
  el.style.height = 'auto'
  if (el.scrollHeight <= 0) return
  const chrome = Math.max(0, el.offsetHeight - el.clientHeight)
  el.style.height = `${el.scrollHeight + chrome}px`
}

/**
 * One cluster card on the gate-B board (LUM-670). Leads with WHAT is being
 * judged — the cluster's name, its one-line thrust and the ideas it holds
 * (collapsed behind a count) — then the three-way verdict toggle, the
 * customization-trap badge, an editable rationale, and a star control usable
 * ONLY on an ALIGNED cluster (and only while the ≤2 star cap has room).
 *
 * Before LUM-685 the card was an anonymous verdict+rationale pair: a reviewer
 * had to reverse-engineer which cluster it referred to from the rationale text.
 * Purely presentational — all state lives in the board.
 */
export function ClusterAlignCard({
  cluster,
  starCapReached,
  onVerdictChange,
  onRationaleChange,
  onToggleStar,
  onToggleIdea,
}: Props) {
  const intl = useIntl()
  // Open by default once something has been dropped, so an unchecked idea is
  // never hidden behind a collapsed disclosure (LUM-688).
  const [ideasOpen, setIdeasOpen] = useState(
    cluster.keptIdeaIds.length < cluster.ideas.length
  )
  const rationaleRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    fitToContent(rationaleRef.current)
  }, [cluster.rationale])

  // A narrower card rewraps the same text into more lines, so refit on WIDTH
  // changes. Observe the wrapper, not the textarea: observing the element whose
  // height we set would re-trigger this observer from its own effect.
  useLayoutEffect(() => {
    const el = rationaleRef.current
    const wrapper = el?.parentElement
    if (!el || !wrapper) return
    let lastWidth = wrapper.getBoundingClientRect().width
    const observer = new ResizeObserver(() => {
      const width = wrapper.getBoundingClientRect().width
      if (width === lastWidth) return
      lastWidth = width
      fitToContent(el)
    })
    observer.observe(wrapper)
    return () => observer.disconnect()
  }, [])
  const keptIds = new Set(cluster.keptIdeaIds)
  // A star means "plan this now" — an emptied cluster has nothing to plan.
  const canStar = cluster.verdict === 'ALIGNED' && keptIds.size > 0
  // Cap only blocks starring a not-yet-starred card; you can always un-star.
  const starDisabled = !canStar || (starCapReached && !cluster.starred)
  const rationaleId = `rationale-${cluster.clusterId}`
  const ideasId = `ideas-${cluster.clusterId}`

  return (
    <Card className='flex flex-col gap-4 p-4'>
      {/* Identity first — the verdict below is about THIS cluster. */}
      <header className='flex flex-col gap-1'>
        <h3 className='text-base font-semibold text-foreground'>
          {cluster.name.trim() ||
            intl.formatMessage({ id: 'planGate.unnamedCluster' })}
        </h3>
        {cluster.thrust ? (
          <p className='text-sm text-muted-foreground'>{cluster.thrust}</p>
        ) : null}
      </header>

      {cluster.ideas.length > 0 ? (
        <div className='flex flex-col gap-2'>
          <Button
            type='button'
            variant='ghost'
            size='sm'
            aria-expanded={ideasOpen}
            aria-controls={ideasId}
            onClick={() => setIdeasOpen(v => !v)}
            className='w-fit px-0 text-xs font-medium text-muted-foreground hover:bg-transparent hover:text-foreground'
          >
            <ChevronRight
              className={cn(
                'mr-1 h-3 w-3 transition-transform duration-200',
                ideasOpen && 'rotate-90'
              )}
              aria-hidden
            />
            {intl.formatMessage(
              { id: 'planGate.ideasKept' },
              { kept: keptIds.size, total: cluster.ideas.length }
            )}
          </Button>
          {ideasOpen ? (
            <ul id={ideasId} className='flex flex-col gap-1.5 pl-1'>
              {cluster.ideas.map(idea => {
                const kept = keptIds.has(idea.id)
                return (
                  <li key={idea.id}>
                    {/* Unchecking drops the idea from THIS plan only — it stays
                        in the pool, unmarked, for a later run (LUM-688). */}
                    <label className='flex items-start gap-2 text-sm leading-relaxed'>
                      <Checkbox
                        checked={kept}
                        onCheckedChange={() => onToggleIdea(idea.id)}
                        className='mt-0.5 shrink-0'
                      />
                      <span
                        className={cn(
                          kept ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        {idea.statement}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Wraps: at narrow widths the star drops below the verdict group rather
          than being pushed off the card's edge (LUM-685). */}
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div
          role='radiogroup'
          aria-label={intl.formatMessage({ id: 'planGate.verdictLabel' })}
          className='inline-flex rounded-md border border-border p-0.5'
        >
          {ALIGN_VERDICTS.map(v => (
            <Button
              key={v}
              type='button'
              role='radio'
              aria-checked={cluster.verdict === v}
              size='sm'
              variant={cluster.verdict === v ? 'default' : 'ghost'}
              onClick={() => onVerdictChange(v)}
            >
              {intl.formatMessage({ id: VERDICT_LABEL[v] })}
            </Button>
          ))}
        </div>

        <Button
          type='button'
          size='sm'
          variant={cluster.starred ? 'default' : 'outline'}
          disabled={starDisabled}
          aria-pressed={cluster.starred}
          onClick={onToggleStar}
          title={intl.formatMessage(
            { id: 'planGate.starHint' },
            { max: MAX_STARRED }
          )}
        >
          <Star
            className={cn('h-4 w-4', cluster.starred && 'fill-current')}
            aria-hidden
          />
          {intl.formatMessage({ id: 'planGate.star' })}
        </Button>
      </div>

      {cluster.customizationTrap && (
        <Badge variant='destructive' className='w-fit'>
          {intl.formatMessage({ id: 'planGate.trapBadge' })}
        </Badge>
      )}

      <div className='flex flex-col gap-1 text-sm'>
        <label htmlFor={rationaleId} className='text-muted-foreground'>
          {intl.formatMessage({ id: 'planGate.rationaleLabel' })}
        </label>
        {/* Textarea, not Input: a rationale is a full sentence and a one-line
            input cut it off mid-text with no way to read the rest (LUM-685). */}
        <Textarea
          id={rationaleId}
          ref={rationaleRef}
          value={cluster.rationale}
          onChange={e => onRationaleChange(e.target.value)}
          rows={2}
          // Height is driven by fitToContent — no inner scrollbar, no drag
          // handle needed, because the box always already fits its content.
          className='resize-none overflow-hidden leading-relaxed'
          placeholder={intl.formatMessage({
            id: 'planGate.rationalePlaceholder',
          })}
        />
      </div>
    </Card>
  )
}
