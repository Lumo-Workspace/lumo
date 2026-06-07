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
import { cmpStatus, cmpPriority } from '../../hooks/useTableSort'
import { formatTimestamp } from '@/lib/utils/formatTimestamp'
import { Spinner } from '@/components/ui/spinner'
import {
  type ColumnId,
  orderColumns,
  COLUMN_GRID_WIDTH,
} from './columnTemplate'

// ─── Ghost trigger style for inline pickers ───────────────────────────────────
const GHOST_TRIGGER =
  'h-7 px-2 border-0 bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 shadow-none text-caption'

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

  const childCount = task._count?.children ?? 0
  const doneCount = task.childrenDoneCount ?? 0

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
      {task.parentTaskId != null && (
        <span className='w-3 h-px bg-muted-foreground/30 inline-block shrink-0' />
      )}
      <span
        className='font-medium group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors cursor-text flex-1 min-w-0'
        onClick={e => {
          e.stopPropagation()
          startEdit()
        }}
      >
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
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            onClick={e => {
              e.stopPropagation()
              onDetailsClick()
            }}
            className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0'
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
            className='text-destructive focus:text-destructive'
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
        headerClassName: 'w-10 px-4',
        cellClassName: 'px-4',
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
      meta: {
        headerClassName: 'w-24 px-8',
        cellClassName: 'px-3',
        gridWidth: COLUMN_GRID_WIDTH.identifier,
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
                    'transition-transform duration-fast',
                    isExpanded && 'rotate-90'
                  )}
                />
              </button>
            ) : (
              <span className='size-4 shrink-0' />
            )}
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
      accessorKey: 'priority',
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
        return <PriorityBadge priority={task.priority} variant='icon' />
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
                dueDate && isOverdue(dueDate) && 'text-red-500 font-medium'
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

    // ── Assignee ───────────────────────────────────────────────────────────
    assignee: {
      id: 'assignee',
      enableSorting: false,
      meta: {
        headerClassName: 'w-24 px-8',
        cellClassName: 'px-8',
        stopPropagation: true,
        gridWidth: COLUMN_GRID_WIDTH.assignee,
      },
      header: () => (
        <span className='text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
          {intl?.formatMessage({
            id: 'task.assignee',
            defaultMessage: 'Assignee',
          }) ?? 'Assignee'}
        </span>
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
