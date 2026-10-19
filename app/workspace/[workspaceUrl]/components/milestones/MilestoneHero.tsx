'use client'

import { useRef } from 'react'
import { useIntl } from 'react-intl'
import type { TaskStatus } from '@prisma/client'
import type { MilestoneUpdateInput } from '@/lib/api-client'
import type { MilestoneHealth } from '@/lib/summaries/milestone-health'
import { useFormatDate } from '../../hooks/useFormatDate'
import { DATE_OPTS, HEALTH_DOT } from './milestoneDisplay'

/** Ring geometry shared by the SVG and the dasharray math. */
const RING_R = 62
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R

interface MilestoneHeroProps {
  name: string
  taskCounts: Record<TaskStatus, number> | null
  health: MilestoneHealth | null
  startDate: string | null
  /** Earliest first-exit-from-TODO across member tasks (min workStartedAt) —
   * the activity-derived start shown when no explicit startDate was set. */
  derivedStartDate: string | null
  targetDate: string | null
  onUpdate: (fields: MilestoneUpdateInput) => void
  archived?: boolean
}

/**
 * The milestone hero: progress ring (done/total), inline-editable name, and a
 * right column of health / start / target stat rows. Honest by construction —
 * a missing value renders an explicit placeholder ("Not set", "Unavailable"),
 * never a fabricated number.
 *
 * The ring reads completion only — done tasks over total. The LUM-650
 * complexity-weighted dual-read was removed in LUM-727: one number, one
 * meaning. LUM-727 also dropped the eyebrow, the key-outcome line and the
 * schedule hint — the hero is the title and the numbers, nothing else.
 */
export function MilestoneHero({
  name,
  taskCounts,
  health,
  startDate,
  derivedStartDate,
  targetDate,
  onUpdate,
  archived = false,
}: MilestoneHeroProps) {
  const intl = useIntl()
  const { fmtDate } = useFormatDate()
  const dateInputRef = useRef<HTMLInputElement>(null)

  const done = taskCounts?.DONE ?? 0
  const total = taskCounts
    ? Object.values(taskCounts).reduce((sum, n) => sum + n, 0)
    : 0
  const pct = total > 0 ? Math.round((done / total) * 100) : null

  const statRow = (labelId: string, value: React.ReactNode) => (
    <div className='flex items-center justify-between gap-3 rounded-md border border-border px-4 py-2.5 text-body'>
      <span className='text-muted-foreground'>
        {intl.formatMessage({ id: labelId })}
      </span>
      {value}
    </div>
  )

  return (
    <section
      aria-label={intl.formatMessage({ id: 'milestone.rollup.label' })}
      className='mb-8 flex flex-col gap-8 lg:flex-row lg:items-center'
    >
      {/* Progress ring — the one graphic; --chart-1 is the single-series color.
          One reading only: completed tasks over total. */}
      <div className='flex shrink-0 flex-col items-center gap-3'>
        <div className='relative h-[150px] w-[150px]'>
          <svg
            width='150'
            height='150'
            viewBox='0 0 150 150'
            className='-rotate-90'
            aria-hidden='true'
          >
            <circle
              cx='75'
              cy='75'
              r={RING_R}
              fill='none'
              stroke='var(--muted)'
              strokeWidth='10'
            />
            {pct !== null && pct > 0 && (
              <circle
                cx='75'
                cy='75'
                r={RING_R}
                fill='none'
                stroke='var(--chart-1)'
                strokeWidth='10'
                strokeLinecap='round'
                strokeDasharray={`${(pct / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
              />
            )}
          </svg>
          <div className='absolute inset-0 flex flex-col items-center justify-center'>
            {total > 0 ? (
              <>
                <span className='text-display tabular-nums'>{pct}%</span>
                <span className='text-caption text-muted-foreground'>
                  {intl.formatMessage(
                    { id: 'milestone.progress' },
                    { done, total }
                  )}
                </span>
              </>
            ) : (
              <span className='px-3 text-center text-caption text-muted-foreground'>
                {intl.formatMessage({ id: 'milestone.rollup.noTasks' })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* The editable title, on its own. */}
      <div className='min-w-0 flex-1'>
        <h1
          key={name}
          contentEditable={!archived}
          suppressContentEditableWarning
          onBlur={e => {
            if (archived) return
            const trimmed = e.currentTarget.textContent?.trim() ?? ''
            if (!trimmed || trimmed === name) {
              e.currentTarget.textContent = name
              return
            }
            onUpdate({ name: trimmed })
          }}
          onKeyDown={e => {
            if (archived) return
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              e.currentTarget.textContent = name
              e.currentTarget.blur()
            }
          }}
          className='cursor-text text-heading outline-none focus:outline-none'
        >
          {name}
        </h1>
      </div>

      {/* Health / start / target stat column. */}
      <div className='flex w-full shrink-0 flex-col gap-2.5 lg:w-72'>
        {statRow(
          'milestone.rollup.health',
          health ? (
            <span className='inline-flex items-center gap-2 text-body-strong'>
              <span
                className={`h-[7px] w-[7px] shrink-0 rounded-full ${HEALTH_DOT[health]}`}
                aria-hidden='true'
              />
              {intl.formatMessage({ id: `milestone.health.${health}` })}
            </span>
          ) : (
            <span className='inline-flex items-center gap-2 text-body-strong text-muted-foreground'>
              <span
                className='h-[7px] w-[7px] shrink-0 rounded-full bg-warning-text'
                aria-hidden='true'
              />
              {intl.formatMessage({ id: 'milestone.hero.healthUnavailable' })}
            </span>
          )
        )}
        {statRow(
          'milestone.field.startDate',
          startDate ? (
            // An explicitly set calendar date (stored at UTC midnight) —
            // format in UTC so the entered day never shifts.
            <span className='text-body-strong tabular-nums'>
              {fmtDate(startDate, DATE_OPTS)}
            </span>
          ) : derivedStartDate ? (
            // Activity-derived: when the first member task actually started
            // (a real timestamp — format in the viewer's zone, no UTC pin).
            <span
              className='text-body-strong tabular-nums'
              title={intl.formatMessage({
                id: 'milestone.hero.startDerivedHint',
              })}
            >
              {fmtDate(derivedStartDate, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </span>
          ) : (
            <span className='text-body-strong text-muted-foreground'>
              {intl.formatMessage({ id: 'milestone.hero.notSet' })}
            </span>
          )
        )}
        {statRow(
          'milestone.field.targetDate',
          targetDate ? (
            <span className='text-body-strong tabular-nums'>
              {fmtDate(targetDate, DATE_OPTS)}
            </span>
          ) : archived ? (
            <span className='text-body-strong text-muted-foreground'>
              {intl.formatMessage({ id: 'milestone.hero.notSet' })}
            </span>
          ) : (
            <span className='relative'>
              <button
                type='button'
                className='text-body-strong text-[var(--chart-1)] hover:underline'
                onClick={() => {
                  const input = dateInputRef.current
                  if (!input) return
                  // Chrome ≥99: open the native calendar directly. Older
                  // engines fall back to focusing the (invisible) input,
                  // which at least enables keyboard entry.
                  try {
                    input.showPicker()
                  } catch {
                    input.focus()
                  }
                }}
              >
                {intl.formatMessage({ id: 'milestone.hero.setDate' })}
              </button>
              {/* pointer-events-none: the CTA button must receive the click
                  (a bare date input opens no picker on click) — the input
                  exists only as the showPicker/keyboard anchor. */}
              <input
                ref={dateInputRef}
                type='date'
                aria-label={intl.formatMessage({
                  id: 'milestone.field.targetDate',
                })}
                className='pointer-events-none absolute inset-0 h-full w-full opacity-0'
                onChange={e => {
                  if (e.target.value) onUpdate({ targetDate: e.target.value })
                }}
              />
            </span>
          )
        )}
      </div>
    </section>
  )
}
