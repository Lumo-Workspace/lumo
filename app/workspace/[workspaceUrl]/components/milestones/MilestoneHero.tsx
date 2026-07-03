'use client'

import { useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import type { TaskStatus } from '@prisma/client'
import type { ApiMilestone, MilestoneUpdateInput } from '@/lib/api-client'
import type { MilestoneHealth } from '@/lib/summaries/milestone-health'
import type { MilestoneWeightedProgress } from '@/lib/summaries/milestone-weighted-progress'
import { useFormatDate } from '../../hooks/useFormatDate'
import { DATE_OPTS, HEALTH_DOT } from './milestoneDisplay'

/** Ring geometry shared by the SVG and the dasharray math. */
const RING_R = 62
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_R

interface MilestoneHeroProps {
  name: string
  taskCounts: Record<TaskStatus, number> | null
  /** LUM-650 complexity-weighted reading for the same ring. `null`/absent (old
   * server) hides the dual-read toggle and the ring stays task-count only. */
  weightedProgress?: MilestoneWeightedProgress | null
  health: MilestoneHealth | null
  startDate: string | null
  /** Earliest first-exit-from-TODO across member tasks (min workStartedAt) —
   * the activity-derived start shown when no explicit startDate was set. */
  derivedStartDate: string | null
  targetDate: string | null
  /** One-line key outcome from the generated retro; null until generated. */
  summaryTldr: string | null
  /** Covering sprints, for the eyebrow — null/empty renders "Milestone" alone. */
  sprintCoverage: ApiMilestone['sprintCoverage']
  onUpdate: (fields: MilestoneUpdateInput) => void
  archived?: boolean
}

/**
 * LUM-636 mission-control hero: progress ring (done/total), eyebrow with the
 * covering sprints, inline-editable name, one-line key outcome, and a right
 * column of health / start / target stat rows. Honest by construction — a
 * missing value renders an explicit placeholder ("Not set", "Unavailable"),
 * never a fabricated number, and schedule health states why it is off until
 * a target date exists.
 *
 * LUM-650 dual-read: the same ring toggles between the task-count reading and
 * a complexity-weighted reading (DONE tasks weighted by
 * TaskComplexity.changedFileCount, a current-status snapshot). The weighted
 * view surfaces its measurement coverage and reads an explicit "no data yet"
 * — never a fabricated 0% — when no member task carries complexity data.
 */
export function MilestoneHero({
  name,
  taskCounts,
  weightedProgress,
  health,
  startDate,
  derivedStartDate,
  targetDate,
  summaryTldr,
  sprintCoverage,
  onUpdate,
  archived = false,
}: MilestoneHeroProps) {
  const intl = useIntl()
  const { fmtDate } = useFormatDate()
  const dateInputRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'tasks' | 'complexity'>('tasks')

  const done = taskCounts?.DONE ?? 0
  const total = taskCounts
    ? Object.values(taskCounts).reduce((sum, n) => sum + n, 0)
    : 0
  const pct = total > 0 ? Math.round((done / total) * 100) : null

  // The weighted reading only offers the dual-read when the server sent it.
  const weighted = weightedProgress ?? null
  const showToggle = weighted !== null
  const complexityMode = showToggle && mode === 'complexity'
  // Arc fraction of whichever reading is active — the ring is one graphic.
  const activePct = complexityMode ? weighted!.pct : pct

  const sprintNames = (sprintCoverage?.sprints ?? []).map(s => s.name)
  const eyebrow =
    sprintNames.length > 0
      ? intl.formatMessage(
          { id: 'milestone.hero.eyebrowWithSprints' },
          { sprints: sprintNames.join(' · ') }
        )
      : intl.formatMessage({ id: 'milestone.hero.eyebrow' })

  const statRow = (labelId: string, value: React.ReactNode) => (
    <div className='flex items-center justify-between gap-3 rounded-md border border-border px-4 py-2.5 text-sm'>
      <span className='text-muted-foreground'>
        {intl.formatMessage({ id: labelId })}
      </span>
      {value}
    </div>
  )

  return (
    <section
      aria-label={intl.formatMessage({ id: 'milestone.rollup.label' })}
      className='mb-8 flex flex-col gap-8 border-b border-border pb-8 lg:flex-row lg:items-center'
    >
      {/* Progress ring — the one graphic; --chart-1 is the single-series color.
          LUM-650: the ring renders whichever reading (task-count / complexity-
          weighted) is toggled active; the toggle sits directly beneath it. */}
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
            {activePct !== null && activePct > 0 && (
              <circle
                cx='75'
                cy='75'
                r={RING_R}
                fill='none'
                stroke='var(--chart-1)'
                strokeWidth='10'
                strokeLinecap='round'
                strokeDasharray={`${(activePct / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
              />
            )}
          </svg>
          <div className='absolute inset-0 flex flex-col items-center justify-center'>
            {complexityMode ? (
              weighted!.pct !== null ? (
                <>
                  <span className='text-3xl font-extrabold tracking-tight tabular-nums'>
                    {weighted!.pct}%
                  </span>
                  <span className='px-3 text-center text-caption text-muted-foreground'>
                    {intl.formatMessage(
                      { id: 'milestone.hero.weightedCoverage' },
                      {
                        measured: weighted!.measuredTasks,
                        total: weighted!.totalTasks,
                      }
                    )}
                  </span>
                </>
              ) : (
                // No measured task (or a measured total of 0 files): explicit,
                // never a fabricated 0%.
                <span className='px-3 text-center text-caption text-muted-foreground'>
                  {intl.formatMessage({
                    id: 'milestone.hero.weightedUnavailable',
                  })}
                </span>
              )
            ) : total > 0 ? (
              <>
                <span className='text-3xl font-extrabold tracking-tight tabular-nums'>
                  {pct}%
                </span>
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
        {showToggle && (
          <div
            role='group'
            aria-label={intl.formatMessage({
              id: 'milestone.hero.progressModeLabel',
            })}
            className='inline-flex items-center gap-2 text-caption'
          >
            <button
              type='button'
              aria-pressed={!complexityMode}
              onClick={() => setMode('tasks')}
              className={
                complexityMode
                  ? 'text-muted-foreground transition-colors hover:text-foreground'
                  : 'font-semibold text-foreground'
              }
            >
              {intl.formatMessage({ id: 'milestone.hero.progressMode.tasks' })}
            </button>
            <span aria-hidden='true' className='text-muted-foreground'>
              ·
            </span>
            <button
              type='button'
              aria-pressed={complexityMode}
              onClick={() => setMode('complexity')}
              className={
                complexityMode
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground transition-colors hover:text-foreground'
              }
            >
              {intl.formatMessage({
                id: 'milestone.hero.progressMode.complexity',
              })}
            </button>
          </div>
        )}
      </div>

      {/* Eyebrow, editable title, key outcome. */}
      <div className='min-w-0 flex-1'>
        <p className='mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground'>
          {eyebrow}
        </p>
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
          className='mb-3 cursor-text text-heading font-bold leading-snug tracking-tight outline-none focus:outline-none'
        >
          {name}
        </h1>
        <p className='text-body leading-relaxed'>
          <span className='font-semibold'>
            {intl.formatMessage({ id: 'milestone.rollup.keyOutcome' })}
          </span>
          <span className='text-muted-foreground'> — </span>
          {summaryTldr ? (
            <span className='text-foreground/80'>{summaryTldr}</span>
          ) : (
            <span className='text-muted-foreground'>
              {intl.formatMessage({ id: 'milestone.rollup.noOutcome' })}
            </span>
          )}
        </p>
      </div>

      {/* Health / start / target stat column. */}
      <div className='flex w-full shrink-0 flex-col gap-2.5 lg:w-72'>
        {statRow(
          'milestone.rollup.health',
          health ? (
            <span className='inline-flex items-center gap-2 font-semibold'>
              <span
                className={`h-[7px] w-[7px] shrink-0 rounded-full ${HEALTH_DOT[health]}`}
                aria-hidden='true'
              />
              {intl.formatMessage({ id: `milestone.health.${health}` })}
            </span>
          ) : (
            <span className='inline-flex items-center gap-2 font-semibold text-muted-foreground'>
              <span
                className='h-[7px] w-[7px] shrink-0 rounded-full bg-[var(--warning)]'
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
            <span className='font-medium tabular-nums'>
              {fmtDate(startDate, DATE_OPTS)}
            </span>
          ) : derivedStartDate ? (
            // Activity-derived: when the first member task actually started
            // (a real timestamp — format in the viewer's zone, no UTC pin).
            <span
              className='font-medium tabular-nums'
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
            <span className='font-medium text-muted-foreground'>
              {intl.formatMessage({ id: 'milestone.hero.notSet' })}
            </span>
          )
        )}
        {statRow(
          'milestone.field.targetDate',
          targetDate ? (
            <span className='font-medium tabular-nums'>
              {fmtDate(targetDate, DATE_OPTS)}
            </span>
          ) : archived ? (
            <span className='font-medium text-muted-foreground'>
              {intl.formatMessage({ id: 'milestone.hero.notSet' })}
            </span>
          ) : (
            <span className='relative'>
              <button
                type='button'
                className='font-semibold text-[var(--chart-1)] hover:underline'
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
        {!targetDate && !archived && (
          <p className='mx-1 text-[11px] leading-normal text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.hero.scheduleHint' })}
          </p>
        )}
      </div>
    </section>
  )
}
