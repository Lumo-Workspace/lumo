'use client'

import { useIntl } from 'react-intl'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  BulkAssigneePicker,
  BulkPriorityPicker,
  BulkStatusPicker,
} from './BulkActionPickers'
import type { ApiPriority, ApiStatus, WorkspaceMemberInfo } from '../../types'

interface BulkPatch {
  status?: ApiStatus
  priority?: ApiPriority
  assigneeActorId?: string | null
}

interface Props {
  /** How many tasks are currently selected — drives the "{n} selected" label. */
  count: number
  members: WorkspaceMemberInfo[]
  onBulkUpdate: (patch: BulkPatch) => void
  /** Open the delete confirmation dialog. Actual deletion happens after confirm. */
  onRequestDelete: () => void
  onClearSelection: () => void
}

/**
 * Overlay shown on top of a task-list toolbar when the user has at least
 * one task selected. Renders the bulk pickers + delete + cancel actions.
 *
 * Caller is responsible for the absolute positioning (`absolute inset-0 z-sticky`)
 * so this can sit inside the same `relative` parent as the page's toolbar.
 */
export function BulkActionBar({
  count,
  members,
  onBulkUpdate,
  onRequestDelete,
  onClearSelection,
}: Props) {
  const intl = useIntl()
  return (
    <div className='absolute inset-0 z-sticky flex items-center justify-between gap-3 bg-muted border-b border-border px-6'>
      <span className='text-caption text-foreground'>
        {intl.formatMessage(
          { id: 'common.selected', defaultMessage: '{count} selected' },
          { count }
        )}
      </span>
      <div className='flex items-center gap-2'>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <BulkStatusPicker onPick={status => onBulkUpdate({ status })} />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {intl.formatMessage({
              id: 'tasks.bulkTooltip.status',
              defaultMessage: 'Set status for selected tasks.',
            })}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <BulkPriorityPicker
                onPick={priority => onBulkUpdate({ priority })}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {intl.formatMessage({
              id: 'tasks.bulkTooltip.priority',
              defaultMessage: 'Set priority for selected tasks.',
            })}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <BulkAssigneePicker
                members={members}
                onPick={assigneeActorId => onBulkUpdate({ assigneeActorId })}
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {intl.formatMessage({
              id: 'tasks.bulkTooltip.assignee',
              defaultMessage: 'Set assignee for selected tasks.',
            })}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='destructive'
              size='sm'
              className='gap-1.5'
              onClick={onRequestDelete}
            >
              <Trash2 size={14} />
              {intl.formatMessage({
                id: 'common.delete',
                defaultMessage: 'Delete',
              })}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {intl.formatMessage({
              id: 'tasks.bulkTooltip.delete',
              defaultMessage: 'Delete selected tasks.',
            })}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant='ghost' size='sm' onClick={onClearSelection}>
              {intl.formatMessage({
                id: 'common.cancel',
                defaultMessage: 'Cancel',
              })}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {intl.formatMessage({
              id: 'common.tooltip.cancel',
              defaultMessage: 'Clear selection.',
            })}
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
