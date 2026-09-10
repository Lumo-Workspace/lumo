'use client'

import type { ReactNode } from 'react'
import { useIntl } from 'react-intl'
import type { RecordGaps } from './record-gaps'

export interface RecordStatusStripProps {
  gaps: RecordGaps
  /** Whether the surrounding tab is in its interactive layout — i.e. the
   *  `#record-machine` / `#record-human` / `#record-crossings` anchors this
   *  strip points at actually exist in the DOM right now (mirrors
   *  AcceptanceTab's own `interactive = status === 'IN_REVIEW'`). When false
   *  (e.g. a DONE task rendering only the settled Records zone, no NEEDS
   *  ACTION zone to jump to) the gap chips render as plain badges instead of
   *  dead links. Defaults to `true`. */
  interactive?: boolean
}

type Tone = 'danger' | 'warning' | 'inReview' | 'success'

const toneClasses: Record<Tone, string> = {
  danger: 'border-danger-border bg-danger-subtle text-danger',
  warning: 'border-warning-border bg-warning-subtle text-warning',
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

  const hasCriteria = gaps.machineTotal > 0 || gaps.humanTotal > 0
  if (!hasCriteria && gaps.crossingsTotal === 0) return null

  const gapChipsPresent =
    gaps.crossingsOpen > 0 || gaps.machineAwaiting > 0 || gaps.humanPending > 0

  const crossingsChip =
    gaps.crossingsOpen > 0 ? (
      <GapChip
        key='crossings'
        href='#record-crossings'
        tone='danger'
        interactive={interactive}
        testId='gap-crossings'
      >
        {intl.formatMessage(
          {
            id: 'record.gap.crossings',
            defaultMessage:
              '{count, plural, one {# crossing} other {# crossings}} to disposition',
          },
          { count: gaps.crossingsOpen }
        )}
      </GapChip>
    ) : null

  const machineChip =
    gaps.machineAwaiting > 0 ? (
      <GapChip
        key='machine'
        href='#record-machine'
        tone='warning'
        interactive={interactive}
        testId='gap-machine'
      >
        {intl.formatMessage(
          {
            id: 'record.gap.machine',
            defaultMessage:
              '{count, plural, one {# machine check} other {# machine checks}} awaiting verification',
          },
          { count: gaps.machineAwaiting }
        )}
      </GapChip>
    ) : null

  const humanChip =
    gaps.humanPending > 0 ? (
      <GapChip
        key='human'
        href='#record-human'
        tone='inReview'
        interactive={interactive}
        testId='gap-human'
      >
        {intl.formatMessage(
          {
            id: 'record.gap.human',
            defaultMessage:
              '{count, plural, one {# call} other {# calls}} need your judgment',
          },
          { count: gaps.humanPending }
        )}
      </GapChip>
    ) : gaps.humanTotal > 0 ? (
      <span
        key='human'
        data-testid='gap-human'
        className={chipClass('success')}
      >
        {intl.formatMessage(
          {
            id: 'record.gap.humanDone',
            defaultMessage: 'Human-judged {done}/{total}',
          },
          { done: gaps.humanTotal - gaps.humanPending, total: gaps.humanTotal }
        )}
      </span>
    ) : null

  const noneChip =
    !gapChipsPresent && gaps.canBeDone ? (
      <span key='none' data-testid='gap-none' className={chipClass('success')}>
        {intl.formatMessage({
          id: 'record.gap.none',
          defaultMessage: 'Nothing left — the task can be marked Done',
        })}
      </span>
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
      {machineChip}
      {noneChip}
      {humanChip}
      {progressChip}
    </div>
  )
}
