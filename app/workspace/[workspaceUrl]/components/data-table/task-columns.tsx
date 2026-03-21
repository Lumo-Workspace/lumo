'use client'

import { useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  MoreHorizontal,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ApiTask } from '../../types'
import { API_STATUS_LABEL } from '../../utils'
import { StatusIcon } from '../StatusIcon'
import { PriorityBadge } from '../PriorityBadge'
import { Button } from '@/components/ui/button'
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

// ─── Sortable column header ───────────────────────────────────────────────────
function SortableColHeader({
  label,
  onClick,
  sorted,
}: {
  label: string
  onClick: () => void
  sorted: false | 'asc' | 'desc'
}) {
  return (
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
  onDeleteTask: (taskId: string) => Promise<void>
): ColumnDef<ApiTask>[] {
  return [
    // ── ID ─────────────────────────────────────────────────────────────────
    {
      id: 'identifier',
      accessorFn: row => `${row.teamIdentifier}-${row.number}`,
      meta: {
        headerClassName: 'w-24 px-8',
        cellClassName: 'px-8',
      },
      header: () => (
        <span className='text-[11px] font-medium uppercase tracking-wider text-muted-foreground'>
          ID
        </span>
      ),
      cell: ({ row }) => (
        <span className='text-xs font-mono text-muted-foreground'>
          {row.original.teamIdentifier}-{row.original.number}
        </span>
      ),
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
          label='Title'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
        />
      ),
      cell: ({ row }) => {
        const task = row.original
        return (
          <div className='flex items-center gap-2'>
            {task.parentTaskId != null && (
              <span className='w-3 h-px bg-muted-foreground/30 inline-block shrink-0' />
            )}
            <span className='font-medium group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors'>
              {task.title}
            </span>
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
          label='Status'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
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
          label='Priority'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
        />
      ),
      cell: ({ row }) => <PriorityBadge priority={row.original.priority} />,
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
          label='Updated'
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          sorted={column.getIsSorted()}
        />
      ),
      cell: ({ row }) => (
        <span className='text-xs text-muted-foreground'>
          {new Date(row.original.updatedAt).toLocaleDateString()}
        </span>
      ),
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
