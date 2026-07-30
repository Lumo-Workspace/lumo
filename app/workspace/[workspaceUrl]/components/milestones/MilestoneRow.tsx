'use client'

import { useIntl } from 'react-intl'
import Link from 'next/link'
import type { ApiMilestone } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { useFormatDate } from '../../hooks/useFormatDate'
import { MilestoneActionsMenu } from './MilestoneActionsMenu'
import {
  DATE_OPTS,
  isArchivedIncomplete,
  milestoneDot,
} from './milestoneDisplay'

interface Props {
  milestone: ApiMilestone
  progress: { done: number; total: number }
  /** Detail-page link for the whole row (the title overlays it). */
  href: string
  onEdit: () => void
  onArchiveToggle: () => void
  onCopyLink: () => void
  onDelete: () => void
}

/**
 * One milestone as a single dense line: status dot · name · actions · progress ·
 * target date. The list is meant to be scanned top to bottom, so every row is
 * the same height and the columns line up — the card grid this replaced put a
 * paragraph of chrome between neighbours.
 *
 * Pure presentation: the parent owns the mutations, the archive confirmation and
 * the edit dialog.
 */
export function MilestoneRow({
  milestone,
  progress,
  href,
  onEdit,
  onArchiveToggle,
  onCopyLink,
  onDelete,
}: Props) {
  const intl = useIntl()
  const { fmtDate } = useFormatDate()

  const archived = !!milestone.archivedAt
  const { done, total } = progress
  const stale = isArchivedIncomplete(archived, done, total)
  const complete = total > 0 && done === total
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const dot = milestoneDot({
    status: milestone.status,
    health: milestone.health,
    stale,
  })
  const dotLabel = intl.formatMessage({ id: dot.labelId })

  return (
    // The row fixes its own height instead of padding around its children: the
    // kebab trigger is 36px (`h-control-md` beats the `size-7` on it — different
    // tailwind-merge groups, so both survive and the custom one wins the
    // cascade), which would otherwise set the row height and loosen the list.
    <div className='group relative flex h-12 items-center gap-3 px-4 transition-colors hover:bg-muted/50'>
      <span
        className={cn('size-2 shrink-0 rounded-full', dot.className)}
        title={dotLabel}
        aria-label={dotLabel}
        role='img'
      />

      <div className='flex min-w-0 flex-1 items-center gap-2'>
        {/* The pseudo-element stretches the link over the whole row, so a click
            anywhere opens the milestone while the accessible name stays the
            name alone. The actions menu lifts itself above it with z-10. */}
        <Link
          href={href}
          className={cn(
            'truncate text-body-strong after:absolute after:inset-0 after:content-[""]',
            stale ? 'text-muted-foreground' : 'text-foreground'
          )}
        >
          {milestone.name}
        </Link>
        {stale && (
          <span className='shrink-0 rounded-sm border border-warning-border bg-warning-subtle px-1.5 py-0.5 text-caption text-foreground'>
            {intl.formatMessage({ id: 'milestone.list.incomplete' })}
          </span>
        )}
      </div>

      <div className='relative z-10 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 has-[[data-state=open]]:opacity-100'>
        <MilestoneActionsMenu
          archived={archived}
          disabled={false}
          onEdit={onEdit}
          onArchiveToggle={onArchiveToggle}
          onCopyLink={onCopyLink}
          onDelete={onDelete}
        />
      </div>

      <div className='flex w-40 shrink-0 items-center gap-2'>
        <div className='h-1 flex-1 overflow-hidden rounded-full bg-muted'>
          <div
            className={cn(
              'h-full rounded-full',
              complete
                ? 'bg-success'
                : stale
                  ? 'bg-muted-foreground/40'
                  : 'bg-info'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span
          className={cn(
            'w-11 shrink-0 text-right text-caption tabular-nums',
            complete ? 'font-semibold text-foreground' : 'text-muted-foreground'
          )}
        >
          {done}/{total}
        </span>
      </div>

      <span
        className={cn(
          'w-[110px] shrink-0 truncate text-right text-caption',
          milestone.targetDate
            ? 'text-muted-foreground'
            : 'text-muted-foreground/60'
        )}
      >
        {milestone.targetDate
          ? fmtDate(milestone.targetDate, DATE_OPTS)
          : intl.formatMessage({ id: 'milestone.targetDate.none' })}
      </span>
    </div>
  )
}
