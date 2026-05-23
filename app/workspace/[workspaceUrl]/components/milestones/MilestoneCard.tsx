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

interface Props {
  milestone: ApiMilestone
  progress: { done: number; total: number }
  workspaceUrl: string
  projectId: string
  onEdit: (m: ApiMilestone) => void
  onDelete: (m: ApiMilestone) => void
}

const STATUS_CLASS: Record<ApiMilestone['status'], string> = {
  PLANNED: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  ACTIVE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  COMPLETED:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  CANCELLED: 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-500',
}

export function MilestoneCard({
  milestone,
  progress,
  workspaceUrl,
  projectId,
  onEdit,
  onDelete,
}: Props) {
  const intl = useIntl()
  const href = `/workspace/${workspaceUrl}/projects/${projectId}/milestones/${milestone.slug}`

  return (
    <div className='rounded-lg border border-zinc-200 dark:border-zinc-800 p-4 hover:bg-zinc-50/50 dark:hover:bg-zinc-900/40 transition-colors'>
      <div className='flex items-start justify-between gap-2'>
        <Link href={href} className='flex-1 font-medium hover:underline'>
          {milestone.name}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='icon' className='h-7 w-7'>
              <MoreHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={() => onEdit(milestone)}>
              {intl.formatMessage({ id: 'milestone.edit' })}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete(milestone)}>
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
        <span>
          {milestone.targetDate
            ? milestone.targetDate.slice(0, 10)
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
