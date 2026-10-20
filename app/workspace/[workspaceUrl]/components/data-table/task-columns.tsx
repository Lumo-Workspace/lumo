'use client'

import { useState, useRef, useCallback } from 'react'
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
import {
  ApiTask,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
  ApiProject,
} from '../../types'
import { formatDueDate, isOverdue } from '../../utils'
import { StatusBadge } from '../StatusBadge'
import { PriorityBadge } from '../PriorityBadge'
import { StatusSelect } from '../fields/StatusSelect'
import { PrioritySelect } from '../fields/PrioritySelect'
import { AssigneeSelect } from '../fields/AssigneeSelect'
import { DueDatePicker } from '../fields/DueDatePicker'
import { ProjectSelect } from '../fields/ProjectSelect'
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
import {
  cmpStatus,
  cmpPriority,
  prioritySortValue,
} from '../../hooks/useTableSort'
import { formatTimestamp } from '@/lib/utils/formatTimestamp'
import { Spinner } from '@/components/ui/spinner'
import {
  type ColumnId,
  orderColumns,
  COLUMN_GRID_WIDTH,
} from './columnTemplate'

// ─── Ghost trigger style for inline pickers ───────────────────────────────────
const GHOST_TRIGGER =
  'h-7 px-2 border-0 bg-transparent hover:bg-muted shadow-none text-caption'

// ─── Update patch type ────────────────────────────────────────────────────────
export type TaskPatch = Partial<{
  title: string
  status: ApiStatus
  priority: ApiPriority
  assigneeActorId: string | null
  dueDate: string | null
  projectId: string
}>

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
        'h-auto px-0 gap-1 text-caption uppercase select-none hover:bg-transparent',
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

// ─── Inline title cell ─────────────────────────────────────────────────────────
function TitleCell({
  task,
  onCommit,
  onDetailsClick,
  intl,
}: {
  task: ApiTask
  onCommit: (title: string) => void
  onDetailsClick: () => void
  intl?: IntlShape | undefined
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = useCallback(() => {
    setDraft(task.title)
    setEditing(true)
  }, [task.title])

  const commit = useCallback(() => {
    const trimmed = draft.trim()
    setEditing(false)
    if (trimmed && trimmed !== task.title) {
      onCommit(trimmed)
    }
  }, [draft, task.title, onCommit])

  const cancel = useCallback(() => {
    setEditing(false)
  }, [])

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onFocus={e => e.target.select()}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Escape') {
            cancel()
          }
        }}
        className='w-full text-body-strong bg-transparent border-0 outline-none focus:ring-0'
        onClick={e => e.stopPropagation()}
      />
    )
  }

  return (
    <div className='flex items-center gap-2 group/title'>
      <span
        className='text-body-strong group-hover:text-info-text transition-colors cursor-text flex-1 min-w-0 truncate'
        title={task.title}
        onClick={e => {
          e.stopPropagation()
          startEdit()
        }}
      >
        {task.title}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            onClick={e => {
              e.stopPropagation()
              onDetailsClick()
            }}
            className='size-6 flex items-center justify-center rounded-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100 shrink-0'
            aria-label={
              intl?.formatMessage({
                id: 'task.openDetails',
                defaultMessage: 'Open details',
              }) ?? 'Open details'
            }
          >
            <ChevronRight size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {intl?.formatMessage({
            id: 'task.openDetails',
            defaultMessage: 'Open details',
          }) ?? 'Open details'}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

// ─── Row actions cell ─────────────────────────────────────────────────────────
function TaskRowActions({
  task,
  onTaskClick,
  onDeleteTask,
  intl,
}: {
  task: ApiTask
  onTaskClick: (task: ApiTask) => void
  onDeleteTask: (taskId: string) => Promise<void>
  intl?: IntlShape | undefined
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
            {intl?.formatMessage({
              id: 'task.openDetails',
              defaultMessage: 'Open details',
            }) ?? 'Open details'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className='text-danger-text focus:text-danger-text'
            onClick={() => setDeleteOpen(true)}
          >
            {intl?.formatMessage({
              id: 'task.deleteTask',
              defaultMessage: 'Delete task',
            }) ?? 'Delete task'}
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
            <AlertDialogTitle>
              {intl?.formatMessage({
                id: 'task.deleteTitle',
                defaultMessage: 'Delete task?',
              }) ?? 'Delete task?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl?.formatMessage(
                {
                  id: 'task.deleteDesc',
                  defaultMessage:
                    '"{title}" will be permanently deleted. This action cannot be undone.',
                },
                { title: task.title }
              ) ??
                `"${task.title}" will be permanently deleted. This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant='outline'>
              {intl?.formatMessage({
                id: 'common.cancel',
                defaultMessage: 'Cancel',
              }) ?? 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => onDeleteTask(task.id)}
            >
              {intl?.formatMessage({
                id: 'common.delete',
                defaultMessage: 'Delete',
              }) ?? 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ─── Column factory options ───────────────────────────────────────────────────
export interface CreateTaskColumnsOptions {
  onTaskClick: (task: ApiTask) => void
  onDeleteTask: (taskId: string) => Promise<void>
  members: WorkspaceMemberInfo[]
  intl?: IntlShape
  updateTask?: (id: string, patch: TaskPatch) => Promise<void> | void
  visibleColumns: ColumnId[]
  projects?: ApiProject[]
}

// ─── Column definitions ───────────────────────────────────────────────────────
export function createTaskColumns(
  options: CreateTaskColumnsOptions
): ColumnDef<ApiTask>[] {
  const {
    onTaskClick,
    onDeleteTask,
    members,
    intl,
    updateTask,
    visibleColumns,
    projects = [],
  } = options

  const memberByActorId = new Map(
    members.filter(m => m.actorId).map(m => [m.actorId!, m])
  )

  const assignableMembers = members.filter(
    (m): m is WorkspaceMemberInfo & { actorId: string } => !!m.actorId
  )

  // Locale + translated labels for the relative "updated" timestamp. Built from
  // intl so the column follows the app language (not the runtime default).
  const timeLocale = intl?.locale ?? 'en'
  const timeMessages = {
    justNow:
      intl?.formatMessage({ id: 'time.justNow', defaultMessage: 'just now' }) ??
      'just now',
    mAgo: (m: number) =>
      intl?.formatMessage(
        { id: 'time.mAgo', defaultMessage: '{m}m ago' },
        { m }
      ) ?? `${m}m ago`,
    today:
      intl?.formatMessage({ id: 'time.today', defaultMessage: 'Today' }) ??
      'Today',
    yesterday:
      intl?.formatMessage({
        id: 'time.yesterday',
        defaultMessage: 'Yesterday',
      }) ?? 'Yesterday',
  }

  const byId: Record<ColumnId, ColumnDef<ApiTask>> = {
    // ── Checkbox ───────────────────────────────────────────────────────────
    select: {
      id: 'select',
      enableSorting: false,
      meta: {
        // The select track is 40px; center the 16px checkbox in it rather than
        // padding it (px-4 = 32px > track, which pushes it off-center).
        headerClassName: 'flex items-center justify-center',
        cellClassName: 'flex items-center justify-center',
        stopPropagation: true,
        gridWidth: COLUMN_GRID_WIDTH.select,
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
          aria-label={
            intl?.formatMessage({
              id: 'task.selectAll',
              defaultMessage: 'Select all tasks',
            }) ?? 'Select all tasks'
          }
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={value => row.toggleSelected(!!value)}
          aria-label={
            intl?.formatMessage(
              { id: 'task.selectOne', defaultMessage: 'Select {title}' },
              { title: (row.original as ApiTask).title }
            ) ?? `Select ${(row.original as ApiTask).title}`
          }
        />
      ),
    },

    // ── ID ─────────────────────────────────────────────────────────────────
    identifier: {
      id: 'identifier',
      accessorFn: row => `${row.teamIdentifier}-${row.number}`,
      enableSorting: true,
      meta: {
        headerClassName: 'px-3',
        cellClassName: 'px-3',
        gridWidth: COLUMN_GRID_WIDTH.identifier,
      },
      // Sort by team identifier first, then by task number numerically (so
      // LUM-10 sorts after LUM-9, not lexicographically before it).
      sortingFn: (a, b) => {
        const team = (a.original.teamIdentifier ?? '').localeCompare(
          b.original.teamIdentifier ?? ''
        )
        if (team !== 0) return team
        return (a.original.number ?? 0) - (b.original.number ?? 0)
      },
      header: ({ column }) => (
        <SortableColHeader
          label='ID'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
        />
      ),
      cell: ({ row }) => {
        const task = row.original

        return (
          <div className='flex items-center gap-1 pl-3'>
            {task.number ? (
              <span className='text-caption font-mono text-muted-foreground'>
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
    title: {
      accessorKey: 'title',
      meta: {
        headerClassName: 'min-w-[300px] px-8',
        cellClassName: 'px-8',
        stopPropagation: true,
        gridWidth: COLUMN_GRID_WIDTH.title,
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
        return (
          <TitleCell
            task={task}
            onCommit={title => updateTask?.(task.id, { title })}
            onDetailsClick={() => onTaskClick(task)}
            intl={intl}
          />
        )
      },
    },

    // ── Project ────────────────────────────────────────────────────────────
    project: {
      id: 'project',
      enableSorting: true,
      meta: {
        gridWidth: COLUMN_GRID_WIDTH.project,
        headerClassName: 'px-8',
        cellClassName: 'px-8',
        stopPropagation: true,
      },
      sortingFn: (a, b) =>
        (a.original.project?.name ?? '').localeCompare(
          b.original.project?.name ?? ''
        ),
      header: ({ column }) => (
        <SortableColHeader
          label={
            intl?.formatMessage({
              id: 'task.project',
              defaultMessage: 'Project',
            }) ?? 'Project'
          }
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
          tooltip={intl?.formatMessage({
            id: 'tasks.tooltip.project',
            defaultMessage: 'Project this task belongs to.',
          })}
        />
      ),
      cell: ({ row }) => {
        const task = row.original
        if (updateTask) {
          return (
            <ProjectSelect
              value={task.projectId}
              projects={projects}
              onChange={projectId => updateTask(task.id, { projectId })}
              triggerClassName={GHOST_TRIGGER}
            />
          )
        }
        return (
          <span className='text-caption text-muted-foreground'>
            {task.project?.name ?? '—'}
          </span>
        )
      },
    },

    // ── Status ─────────────────────────────────────────────────────────────
    status: {
      accessorKey: 'status',
      meta: {
        headerClassName: 'w-36 px-8',
        cellClassName: 'px-8',
        stopPropagation: true,
        gridWidth: COLUMN_GRID_WIDTH.status,
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
      cell: ({ row }) => {
        const task = row.original
        if (updateTask) {
          return (
            <StatusSelect
              value={task.status}
              onChange={status => updateTask(task.id, { status })}
              triggerClassName={GHOST_TRIGGER}
            />
          )
        }
        return <StatusBadge status={task.status} />
      },
    },

    // ── Priority ───────────────────────────────────────────────────────────
    priority: {
      id: 'priority',
      // NONE reads as undefined so `sortUndefined: 'last'` pins it last in
      // both directions (LUM-1284); cells render from row.original.
      accessorFn: row => prioritySortValue(row.priority),
      sortUndefined: 'last',
      meta: {
        headerClassName: 'w-28 px-8',
        cellClassName: 'px-8',
        stopPropagation: true,
        gridWidth: COLUMN_GRID_WIDTH.priority,
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
      cell: ({ row }) => {
        const task = row.original
        if (updateTask) {
          return (
            <PrioritySelect
              value={task.priority}
              onChange={priority => updateTask(task.id, { priority })}
              triggerClassName={GHOST_TRIGGER}
            />
          )
        }
        return <PriorityBadge priority={task.priority} variant='label' />
      },
    },

    // ── Due Date ──────────────────────────────────────────────────────────
    dueDate: {
      accessorKey: 'dueDate',
      meta: {
        headerClassName: 'w-28 px-8',
        cellClassName: 'px-8',
        stopPropagation: true,
        gridWidth: COLUMN_GRID_WIDTH.dueDate,
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
        const task = row.original
        const dueDate = task.dueDate ?? null
        if (updateTask) {
          return (
            <DueDatePicker
              value={dueDate}
              onChange={v => updateTask(task.id, { dueDate: v })}
              triggerClassName={cn(
                GHOST_TRIGGER,
                'text-caption',
                !dueDate && 'text-muted-foreground',
                dueDate && isOverdue(dueDate) && 'text-danger-text'
              )}
            />
          )
        }
        if (!dueDate) {
          return <span className='text-caption text-muted-foreground'>—</span>
        }
        return (
          <span
            className={cn(
              'text-caption',
              isOverdue(dueDate) ? 'text-danger-text' : 'text-muted-foreground'
            )}
          >
            {formatDueDate(dueDate)}
          </span>
        )
      },
    },

    // ── Assignee ───────────────────────────────────────────────────────────
    assignee: {
      id: 'assignee',
      enableSorting: true,
      meta: {
        headerClassName: 'px-8 whitespace-nowrap',
        cellClassName: 'px-8',
        stopPropagation: true,
        gridWidth: COLUMN_GRID_WIDTH.assignee,
      },
      // Sort by the assignee's display name; unassigned rows (empty string)
      // collate first in ascending order.
      sortingFn: (a, b) => {
        const an = a.original.assignee?.id
          ? (memberByActorId.get(a.original.assignee.id)?.name ?? '')
          : ''
        const bn = b.original.assignee?.id
          ? (memberByActorId.get(b.original.assignee.id)?.name ?? '')
          : ''
        return an.localeCompare(bn)
      },
      header: ({ column }) => (
        <SortableColHeader
          label={
            intl?.formatMessage({
              id: 'task.assignee',
              defaultMessage: 'Assignee',
            }) ?? 'Assignee'
          }
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
        />
      ),
      cell: ({ row }) => {
        const task = row.original
        const assigneeActorId = task.assignee?.id ?? null
        if (updateTask) {
          return (
            <AssigneeSelect
              value={assigneeActorId}
              onChange={v => updateTask(task.id, { assigneeActorId: v })}
              members={assignableMembers}
              assignee={task.assignee ?? null}
              triggerClassName={GHOST_TRIGGER}
            />
          )
        }
        const member = assigneeActorId
          ? memberByActorId.get(assigneeActorId)
          : null
        return member ? (
          <span className='text-caption text-muted-foreground'>
            {member.name}
          </span>
        ) : (
          <span className='text-caption text-muted-foreground'>—</span>
        )
      },
    },

    // ── Updated At ─────────────────────────────────────────────────────────
    updatedAt: {
      accessorKey: 'updatedAt',
      meta: {
        headerClassName: 'w-32 px-8',
        cellClassName: 'px-8',
        gridWidth: COLUMN_GRID_WIDTH.updatedAt,
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
        <span className='text-caption text-muted-foreground whitespace-nowrap'>
          {formatTimestamp(row.original.updatedAt, timeLocale, timeMessages)}
        </span>
      ),
    },

    // ── Row actions ────────────────────────────────────────────────────────
    actions: {
      id: 'actions',
      enableSorting: false,
      meta: {
        stopPropagation: true,
        headerClassName: 'w-12 pr-4',
        cellClassName: 'w-12 pr-4',
        gridWidth: COLUMN_GRID_WIDTH.actions,
      },
      header: () => null,
      cell: ({ row }) => (
        <TaskRowActions
          task={row.original}
          onTaskClick={onTaskClick}
          onDeleteTask={onDeleteTask}
          intl={intl}
        />
      ),
    },
  }

  return orderColumns(visibleColumns).map(id => byId[id])
}
