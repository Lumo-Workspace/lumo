'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import type { RecordGaps } from './record-gaps'

export interface RecordStatusStripProps {
  gaps: RecordGaps
  /** Whether the chips are live anchors — true iff RecordTab is rendering
   *  a NEEDS ACTION zone, so the `#record-crossings` target this strip points
   *  at actually exists in the DOM right now. When false (nothing left to act on — e.g. a DONE task, or
   *  a task whose gaps are all settled, showing only the Records zone) the gap
   *  chips render as plain badges instead of dead links. Defaults to `true`. */
  interactive?: boolean
}

type Tone = 'danger' | 'inReview' | 'success'

const toneClasses: Record<Tone, string> = {
  danger: 'border-danger-border bg-danger-subtle text-danger-text',
  inReview:
    'border-status-in-review-border bg-status-in-review-subtle text-status-in-review',
  success: 'border-success-border bg-success-subtle text-success',
}

const chipClass = (tone: Tone) =>
  `inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-medium ${toneClasses[tone]}`

function GapChip({
  href,
  tone,
  interactive,
  testId,
  children,
}: {
  href: string
  tone: Tone
  interactive: boolean
  testId: string
  children: ReactNode
}) {
  if (interactive) {
    return (
      <a href={href} data-testid={testId} className={chipClass(tone)}>
        {children}
      </a>
    )
  }
  return (
    <span data-testid={testId} className={chipClass(tone)}>
      {children}
    </span>
  )
}

/**
 * The Record tab's Done-gap status strip (LUM-496): a one-line "still needed
 * for Done" summary rendered above the NEEDS ACTION / Records zones, with
 * anchor chips into each gap. Purely presentational over `RecordGaps` — all
 * derivation lives in `record-gaps.ts`.
 */
export function RecordStatusStrip({
  gaps,
  interactive = true,
}: RecordStatusStripProps) {
  const intl = useIntl()

  if (gaps.crossingsTotal === 0) return null

  const gapChipsPresent = gaps.crossingsOpen > 0

  // Review F5: open-but-advisory crossings (or any open crossing while the
  // workspace gate is off) still need a disposition, but they do not block
  // Done — danger red overstated them. They get the in-review tone and copy
  // that says what they actually are.
  const crossingsAdvisoryOnly =
    gaps.crossingsOpen > 0 && gaps.crossingsBlocking === 0
  const crossingsChip =
    gaps.crossingsOpen > 0 ? (
      <GapChip
        key='crossings'
        href='#record-crossings'
        tone={crossingsAdvisoryOnly ? 'inReview' : 'danger'}
        interactive={interactive}
        testId='gap-crossings'
      >
        {crossingsAdvisoryOnly
          ? intl.formatMessage(
              {
                id: 'record.gap.crossingsAdvisory',
                defaultMessage:
                  '{count, plural, one {# advisory crossing} other {# advisory crossings}} to disposition',
              },
              { count: gaps.crossingsOpen }
            )
          : intl.formatMessage(
              {
                id: 'record.gap.crossings',
                defaultMessage:
                  '{count, plural, one {# crossing} other {# crossings}} to disposition',
              },
              { count: gaps.crossingsOpen }
            )}
      </GapChip>
    ) : null

  // Review F3: on a task already accepted, "the task can be marked Done" is
  // an instruction for a decision that was taken — the same slot states the
  // outcome instead. Same tone, same position, different tense.
  const noneChip =
    !gapChipsPresent && gaps.canBeDone ? (
      gaps.taskDone ? (
        <span
          key='none'
          data-testid='gap-accepted'
          className={chipClass('success')}
        >
          {intl.formatMessage({
            id: 'record.gap.accepted',
            defaultMessage: 'Accepted — this task is Done',
          })}
        </span>
      ) : (
        <span
          key='none'
          data-testid='gap-none'
          className={chipClass('success')}
        >
          {intl.formatMessage({
            id: 'record.gap.none',
            defaultMessage: 'Nothing left — the task can be marked Done',
          })}
        </span>
      )
    ) : null

  const progressChip =
    gaps.crossingsTotal > 0 ? (
      <span
        key='progress'
        data-testid='gap-progress'
        className='ml-auto text-caption text-muted-foreground'
      >
        {intl.formatMessage(
          {
            id: 'record.gap.progress',
            defaultMessage: 'Dispositioned {done}/{total}',
          },
          {
            done: gaps.crossingsTotal - gaps.crossingsOpen,
            total: gaps.crossingsTotal,
          }
        )}
      </span>
    ) : null

  return (
    <div className='flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2'>
      <span className='text-body-strong text-foreground'>
        {intl.formatMessage({
          id: 'record.gap.title',
          defaultMessage: 'Still needed for Done',
        })}
      </span>
      {crossingsChip}
      {progressChip}
      {/* Review F7: the settled-state chip closes the line, after the
          disposition-progress reading (mockup order). */}
      {noneChip}
    </div>
  )
}
