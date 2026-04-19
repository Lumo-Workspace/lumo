'use client'

import { useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import type { IntlShape } from 'react-intl'
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronRight,
  MoreHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ApiTask, WorkspaceMemberInfo } from '../../types'
import { API_STATUS_LABEL, formatDueDate, isOverdue } from '../../utils'
import { StatusIcon } from '../StatusIcon'
import { PriorityBadge } from '../PriorityBadge'
import { MemberAvatar } from '../fields/shared'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Trash2 } from 'lucide-react'
import { cmpStatus, cmpPriority } from '../../hooks/useTableSort'
import { Spinner } from '@/components/ui/spinner'

// ─── Sortable column header ───────────────────────────────────────────────────
function SortableColHeader({
  label,
  onClick,
  sorted,
  tooltip,
}: {
  label: string
  onClick: () => void
  sorted: false | 'asc' | 'desc'
  tooltip?: string | undefined
}) {
  const button = (
    <Button
      variant='ghost'
      onClick={onClick}
      className={cn(
        'h-auto px-0 gap-1 text-[11px] font-medium uppercase tracking-wider select-none hover:bg-transparent',
        sorted
          ? 'text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
      {sorted === 'asc' ? (
        <ChevronUp size={12} />
      ) : sorted === 'desc' ? (
        <ChevronDown size={12} />
      ) : (
        <ChevronsUpDown size={12} className='opacity-40' />
      )}
    </Button>
  )

  if (!tooltip) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

// ─── Row actions cell ─────────────────────────────────────────────────────────
function TaskRowActions({
  task,
  onTaskClick,
  onDeleteTask,
}: {
  task: ApiTask
  onTaskClick: (task: ApiTask) => void
  onDeleteTask: (taskId: string) => Promise<void>
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <>
      {/* Dropdown menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant='ghost'
            size='icon'
            className='size-7 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100 transition-opacity'
          >
            <MoreHorizontal size={14} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-44'>
          <DropdownMenuItem onClick={() => onTaskClick(task)}>
            Open task
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className='text-destructive focus:text-destructive'
            onClick={() => setDeleteOpen(true)}
          >
            Delete task
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Confirmation dialog — controlled, separate from DropdownMenu */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent size='sm'>
          <AlertDialogHeader>
            <AlertDialogMedia className='bg-destructive/10 text-destructive dark:bg-destructive/20 dark:text-destructive'>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{task.title}&rdquo; will be permanently deleted. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => onDeleteTask(task.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ─── Column definitions ───────────────────────────────────────────────────────
export function createTaskColumns(
  onTaskClick: (task: ApiTask) => void,
  onDeleteTask: (taskId: string) => Promise<void>,
  members: WorkspaceMemberInfo[] = [],
  intl?: IntlShape
): ColumnDef<ApiTask>[] {
  const memberByActorId = new Map(
    members.filter(m => m.actorId).map(m => [m.actorId!, m])
  )

  return [
    // ── Checkbox ───────────────────────────────────────────────────────────
    {
      id: 'select',
      enableSorting: false,
      meta: {
        headerClassName: 'w-10 px-4',
        cellClassName: 'px-4',
        stopPropagation: true,
      },
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? 'indeterminate'
                : false
          }
          onCheckedChange={value => table.toggleAllPageRowsSelected(!!value)}
          aria-label='Select all tasks'
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={value => row.toggleSelected(!!value)}
          aria-label={`Select ${(row.original as ApiTask).title}`}
        />
      ),
    },

    // ── ID ─────────────────────────────────────────────────────────────────
    {
      id: 'identifier',
      accessorFn: row => `${row.teamIdentifier}-${row.number}`,
      meta: {
        headerClassName: 'w-24 px-8',
        cellClassName: 'px-3',
      },
      header: () => (
        <span className='text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
          ID
        </span>
      ),
      cell: ({ row, table }) => {
        const task = row.original
        const meta = table.options.meta
        const parentId = meta?.getParentId?.(task)
        const childCount = meta?.getChildCount?.(task) ?? 0
        const isExpanded = meta?.expanded?.has(task.id) ?? false
        const isChild = !!parentId

        return (
          <div
            className={cn('flex items-center gap-1', isChild ? 'pl-7' : 'pl-3')}
          >
            {childCount > 0 ? (
              <button
                type='button'
                onClick={e => {
                  e.stopPropagation()
                  meta?.toggleExpand?.(task.id)
                }}
                className='flex items-center justify-center size-4 shrink-0 text-muted-foreground hover:text-foreground transition-colors'
              >
                <ChevronRight
                  size={14}
                  className={cn(
                    'transition-transform duration-150',
                    isExpanded && 'rotate-90'
                  )}
                />
              </button>
            ) : (
              <span className='size-4 shrink-0' />
            )}
            {task.number ? (
              <span className='text-xs font-mono text-muted-foreground'>
                {task.teamIdentifier}-{task.number}
              </span>
            ) : (
              <Spinner className='size-3 text-muted-foreground' />
            )}
          </div>
        )
      },
    },

    // ── Title ──────────────────────────────────────────────────────────────
    {
      accessorKey: 'title',
      meta: {
        headerClassName: 'min-w-[300px] px-8',
        cellClassName: 'px-8',
      },
      header: ({ column }) => (
        <SortableColHeader
          label={
            intl?.formatMessage({
              id: 'task.title',
              defaultMessage: 'Title',
            }) ?? 'Title'
          }
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
          tooltip={intl?.formatMessage({
            id: 'tasks.tooltip.title',
            defaultMessage: 'Task title.',
          })}
        />
      ),
      cell: ({ row }) => {
        const task = row.original
        const childCount = task._count?.children ?? 0
        const doneCount = task.childrenDoneCount ?? 0
        return (
          <div className='flex items-center gap-2'>
            {task.parentTaskId != null && (
              <span className='w-3 h-px bg-muted-foreground/30 inline-block shrink-0' />
            )}
            <span className='font-medium group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors'>
              {task.title}
            </span>
            {childCount > 0 && (
              <span className='inline-flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums shrink-0'>
                <span className='inline-block w-8 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden'>
                  <span
                    className='block h-full bg-blue-500 rounded-full'
                    style={{
                      width: `${Math.round((doneCount / childCount) * 100)}%`,
                    }}
                  />
                </span>
                {doneCount}/{childCount}
              </span>
            )}
          </div>
        )
      },
    },

    // ── Status ─────────────────────────────────────────────────────────────
    {
      accessorKey: 'status',
      meta: {
        headerClassName: 'w-36 px-8',
        cellClassName: 'px-8',
      },
      sortingFn: (rowA, rowB) =>
        cmpStatus(rowA.original.status, rowB.original.status),
      header: ({ column }) => (
        <SortableColHeader
          label={
            intl?.formatMessage({
              id: 'task.status',
              defaultMessage: 'Status',
            }) ?? 'Status'
          }
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
          tooltip={intl?.formatMessage({
            id: 'tasks.tooltip.status',
            defaultMessage:
              'Workflow stage: To Do, In Progress, In Review, or Done.',
          })}
        />
      ),
      cell: ({ row }) => (
        <div className='flex items-center gap-2 text-muted-foreground'>
          <StatusIcon status={row.original.status} />
          <span className='text-xs'>
            {API_STATUS_LABEL[row.original.status] ?? row.original.status}
          </span>
        </div>
      ),
    },

    // ── Priority ───────────────────────────────────────────────────────────
    {
      accessorKey: 'priority',
      meta: {
        headerClassName: 'w-28 px-8',
        cellClassName: 'px-8',
      },
      sortingFn: (rowA, rowB) =>
        cmpPriority(rowA.original.priority, rowB.original.priority),
      header: ({ column }) => (
        <SortableColHeader
          label={
            intl?.formatMessage({
              id: 'task.priority',
              defaultMessage: 'Priority',
            }) ?? 'Priority'
          }
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
          tooltip={intl?.formatMessage({
            id: 'tasks.tooltip.priority',
            defaultMessage: 'Priority level: Urgent, High, Medium, or Low.',
          })}
        />
      ),
      cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
    },

    // ── Due Date ──────────────────────────────────────────────────────────
    {
      accessorKey: 'dueDate',
      meta: {
        headerClassName: 'w-28 px-8',
        cellClassName: 'px-8',
      },
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.dueDate
          ? new Date(rowA.original.dueDate).getTime()
          : Infinity
        const b = rowB.original.dueDate
          ? new Date(rowB.original.dueDate).getTime()
          : Infinity
        return a - b
      },
      header: ({ column }) => (
        <SortableColHeader
          label={
            intl?.formatMessage({
              id: 'taskColumns.dueDate',
              defaultMessage: 'Due Date',
            }) ?? 'Due Date'
          }
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
        />
      ),
      cell: ({ row }) => {
        const dueDate = row.original.dueDate
        if (!dueDate) {
          return <span className='text-xs text-muted-foreground'>—</span>
        }
        return (
          <span
            className={cn(
              'text-xs',
              isOverdue(dueDate)
                ? 'text-red-500 font-medium'
                : 'text-muted-foreground'
            )}
          >
            {formatDueDate(dueDate)}
          </span>
        )
      },
    },

    // ── Updated At ─────────────────────────────────────────────────────────
    {
      accessorKey: 'updatedAt',
      meta: {
        headerClassName: 'w-32 px-8 text-right',
        cellClassName: 'px-8 text-right',
      },
      header: ({ column }) => (
        <SortableColHeader
          label={
            intl?.formatMessage({
              id: 'common.updated',
              defaultMessage: 'Updated',
            }) ?? 'Updated'
          }
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
          tooltip={intl?.formatMessage({
            id: 'tasks.tooltip.updated',
            defaultMessage: 'Last time this task was modified.',
          })}
        />
      ),
      cell: ({ row }) => (
        <span className='text-xs text-muted-foreground'>
          {new Date(row.original.updatedAt).toLocaleDateString()}
        </span>
      ),
    },

    // ── Assignee ───────────────────────────────────────────────────────────
    {
      id: 'assignee',
      enableSorting: false,
      meta: {
        headerClassName: 'w-24 px-8',
        cellClassName: 'px-8',
      },
      header: () => (
        <span className='text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
          Assignee
        </span>
      ),
      cell: ({ row }) => {
        const assigneeActorId = row.original.assignee?.id ?? null
        const member = assigneeActorId
          ? memberByActorId.get(assigneeActorId)
          : null
        return member ? (
          <MemberAvatar member={member} />
        ) : (
          <span className='text-xs text-muted-foreground'>—</span>
        )
      },
    },

    // ── Row actions ────────────────────────────────────────────────────────
    {
      id: 'actions',
      enableSorting: false,
      meta: {
        stopPropagation: true,
        headerClassName: 'w-12 pr-4',
        cellClassName: 'w-12 pr-4',
      },
      header: () => null,
      cell: ({ row }) => (
        <TaskRowActions
          task={row.original}
          onTaskClick={onTaskClick}
          onDeleteTask={onDeleteTask}
        />
      ),
    },
  ]
}
