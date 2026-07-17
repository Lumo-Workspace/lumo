'use client'

import { useEffect, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/** One bucket an idea can be moved into (a cluster, or the orphan zone). */
export interface MoveTarget {
  value: string
  label: string
}

interface IdeaCardProps {
  statement: string
  sourceContext: string | null
  /** Buckets this idea can move to; the current bucket is already excluded. */
  moveTargets: MoveTarget[]
  /** Accessible name for the move control (identifies which idea it moves). */
  moveLabel: string
  onMove: (target: string) => void
  /** False once the gate is closed — the card renders read-only. */
  movable: boolean
}

/** Lines of the statement shown before the expand affordance appears.
 *  Literal class (not interpolated) — Tailwind only emits classes it can see
 *  verbatim in the source. */
const CLAMP_CLASS = 'line-clamp-3'

/**
 * Does this element's content exceed its (line-clamped) box? Split out as a
 * pure predicate over the two layout reads so it stays testable — jsdom always
 * reports 0 for both, so the DOM measurement itself can't be exercised there.
 * The 1px slack absorbs sub-pixel rounding of fractional line-heights.
 */
export function isOverflowing(
  el: Pick<HTMLElement, 'scrollHeight' | 'clientHeight'>
): boolean {
  return el.scrollHeight - el.clientHeight > 1
}

/**
 * One idea on the gate-A board (LUM-685). The statement owns the card's full
 * width — the move control lives in the footer, below the text, so it can never
 * compete for horizontal space; and it is a portalled menu whose trigger label
 * is a fixed string, so an arbitrarily long cluster name changes the menu's
 * contents but never the trigger's width (the LUM-685 regression: a native
 * <select> sizes to its widest <option>, so LLM-named clusters crushed the
 * statement into a 2-3-character strip and overflowed the column).
 *
 * Long statements clamp to CLAMP_LINES with a show-more/less toggle, bounding
 * the card height. Purely presentational — bucket state lives in the board.
 */
export function IdeaCard({
  statement,
  sourceContext,
  moveTargets,
  moveLabel,
  onMove,
  movable,
}: IdeaCardProps) {
  const intl = useIntl()
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)

  // Measure only while collapsed: expanding removes the clamp, which would make
  // the probe report "fits" and hide the toggle the user needs to collapse
  // again. Re-measured on resize because the overflow depends on column width.
  useEffect(() => {
    if (expanded) return
    const el = textRef.current
    if (!el) return
    const measure = () => setClamped(isOverflowing(el))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [statement, expanded])

  const showToggle = clamped || expanded

  return (
    <li className='rounded-md border border-border bg-card p-3'>
      <p
        ref={textRef}
        className={cn(
          'text-sm leading-relaxed text-foreground',
          !expanded && CLAMP_CLASS
        )}
      >
        {statement}
      </p>

      {showToggle ? (
        <button
          type='button'
          aria-expanded={expanded}
          onClick={() => setExpanded(v => !v)}
          className='mt-1 rounded-sm text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
        >
          {intl.formatMessage({
            id: expanded ? 'planGateA.showLess' : 'planGateA.showMore',
          })}
        </button>
      ) : null}

      {sourceContext || movable ? (
        <div className='mt-3 flex items-center justify-between gap-2'>
          <span className='min-w-0 flex-1 truncate text-xs text-muted-foreground'>
            {sourceContext}
          </span>
          {movable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  aria-label={moveLabel}
                  className='shrink-0 text-muted-foreground'
                >
                  {intl.formatMessage({ id: 'planGateA.moveTo' })}
                  <ChevronDown className='ml-1 h-3 w-3' aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              {/* Portalled + capped: a long cluster name wraps inside the menu
                  instead of widening anything on the board. */}
              <DropdownMenuContent align='end' className='max-w-64'>
                {moveTargets.map(target => (
                  <DropdownMenuItem
                    key={target.value}
                    onSelect={() => onMove(target.value)}
                  >
                    <span className='truncate'>{target.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
