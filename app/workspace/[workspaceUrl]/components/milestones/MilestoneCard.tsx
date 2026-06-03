'use client'

import { useIntl } from 'react-intl'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import type { ApiMilestone } from '@/lib/api-client'
import type { MilestoneHealth } from '@/lib/summaries/milestone-health'
import { useFormatDate } from '../../hooks/useFormatDate'
import { STATUS_CLASS, DATE_OPTS } from './milestoneDisplay'

interface Props {
  milestone: ApiMilestone
  progress: { done: number; total: number }
  workspaceUrl: string
  projectSlug: string
  onEdit: (m: ApiMilestone) => void
  onDelete: (m: ApiMilestone) => void
  onArchive: (m: ApiMilestone) => void
  onUnarchive: (m: ApiMilestone) => void
}

// A single ~7px dot is the one allowed colour signal (typography carries the
// rest of the hierarchy). Colour encodes the target-date health light.
const HEALTH_DOT: Record<MilestoneHealth, string> = {
  'on-track': 'bg-emerald-500',
  'at-risk': 'bg-amber-500',
  overdue: 'bg-red-500',
}

export function MilestoneCard({
  milestone,
  progress,
  workspaceUrl,
  projectSlug,
  onEdit,
  onDelete,
  onArchive,
  onUnarchive,
}: Props) {
  const intl = useIntl()
  const { fmtDate } = useFormatDate()
  const href = `/workspace/${workspaceUrl}/projects/${projectSlug}/milestones/${milestone.slug}`
  const archived = !!milestone.archivedAt

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/40 transition-colors'>
      <div className='flex items-start justify-between gap-2'>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          {milestone.health && (
            <span
              className={`h-[7px] w-[7px] shrink-0 rounded-full ${HEALTH_DOT[milestone.health]}`}
              title={intl.formatMessage({
                id: `milestone.health.${milestone.health}`,
              })}
              aria-label={intl.formatMessage({
                id: `milestone.health.${milestone.health}`,
              })}
            />
          )}
          <Link href={href} className='truncate font-medium hover:underline'>
            {milestone.name}
          </Link>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='h-7 w-7'
              aria-label={intl.formatMessage({ id: 'milestone.actions' })}
            >
              <MoreHorizontal size={16} aria-hidden='true' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            {!archived && (
              <DropdownMenuItem onClick={() => onEdit(milestone)}>
                {intl.formatMessage({ id: 'milestone.edit' })}
              </DropdownMenuItem>
            )}
            {archived ? (
              <DropdownMenuItem onClick={() => onUnarchive(milestone)}>
                {intl.formatMessage({ id: 'milestone.unarchive' })}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onArchive(milestone)}>
                {intl.formatMessage({ id: 'milestone.archive' })}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              className='text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400'
              onClick={() => onDelete(milestone)}
            >
              {intl.formatMessage({ id: 'milestone.delete' })}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className='mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400'>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASS[milestone.status]}`}
        >
          {intl.formatMessage({ id: `milestone.status.${milestone.status}` })}
        </span>
        {archived && (
          <span className='inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground'>
            {intl.formatMessage({ id: 'milestone.archived' })}
          </span>
        )}
        <span>
          {milestone.targetDate
            ? fmtDate(milestone.targetDate, DATE_OPTS)
            : intl.formatMessage({ id: 'milestone.targetDate.none' })}
        </span>
        <span>
          {intl.formatMessage(
            { id: 'milestone.progress' },
            { done: progress.done, total: progress.total }
          )}
        </span>
      </div>
    </div>
  )
}
