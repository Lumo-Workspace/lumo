'use client'

import { useState, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { Plus, CheckSquare, Trash2, ChevronDown } from 'lucide-react'
import { MyTask, ApiStatus, ApiPriority, WorkspaceMemberInfo } from '../../types'
import { API_STATUS_LABEL } from '../../utils'
import { StatusIcon } from '../StatusIcon'
import { PriorityBadge } from '../PriorityBadge'
import { BoardView } from '../board/BoardView'
import { MyTaskCard } from '../board/SortableTaskCard'
import { useBoardDrag } from '../../hooks/useBoardDrag'
import { SortableHeader } from '../SortableHeader'
import { ViewToggle } from '../ViewToggle'
import { DisplayOptionsMenu } from '../DisplayOptionsMenu'
import { AsyncContent } from '../AsyncContent'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  useTableSort,
  applyDir,
  cmpString,
  cmpStatus,
  cmpPriority,
  cmpDate,
} from '../../hooks/useTableSort'
import { useBoardSensors } from '../../hooks/useBoardSensors'
import { useDisplayOptions } from '../../hooks/useDisplayOptions'
import { filterCompletedTasks } from '../../utils/filterCompletedTasks'
import { sortTasks, ORDERING_LABELS } from '../../utils/sortTasks'
import { CACHE_KEY } from '../../constants'
import { Checkbox } from '@/components/ui/checkbox'
import { MemberAvatar } from '../fields/shared'
import { PRIORITY_CONFIG } from '../fields/shared'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Command,
  CommandList,
  CommandItem,
  CommandInput,
} from '@/components/ui/command'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { tasksClient } from '@/lib/api-client'
import { toast } from 'sonner'

type MyTaskSortKey =
  | 'title'
  | 'project'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'owner'
  | 'updatedAt'

interface MyTasksPageProps {
  tasks: MyTask[]
  setTasks: React.Dispatch<React.SetStateAction<MyTask[]>>
  viewId: string | null
  userId: string
  loading: boolean
  error: string | null
  onRetry: () => void
  onTaskClick: (task: MyTask) => void
  onNewTask: (status?: ApiStatus) => void
  members: WorkspaceMemberInfo[]
}

export function MyTasksPage({
  tasks,
  setTasks,
  viewId,
  userId,
  loading,
  error,
  onRetry,
  onTaskClick,
  onNewTask,
  members,
}: MyTasksPageProps) {
  const intl = useIntl()
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list')
  const { options, setCompletedFilter, setOrdering, setShowSubtasks } =
    useDisplayOptions(CACHE_KEY.displayMyTasks(userId))
  const filteredTasks = useMemo(() => {
    let result = filterCompletedTasks(tasks, options.completedFilter)
    if (!options.showSubtasks) {
      result = result.filter(t => !t.parentTaskId)
    }
    return sortTasks(result, options.ordering)
  }, [tasks, options.completedFilter, options.ordering, options.showSubtasks])

  const sensors = useBoardSensors()

  const { activeId, onDragStart, onDragOver, onDragEnd } = useBoardDrag({
    tasks,
    setTasks,
    viewId,
  })

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Page header */}
      <header className='pt-4 pb-4 px-4 md:px-8 flex items-center justify-between shrink-0'>
        <h1 className='text-lg font-semibold text-zinc-900 dark:text-zinc-100'>
          {intl.formatMessage({ id: 'sidebar.myTasks' })}
        </h1>
        <Button onClick={() => onNewTask()} size='sm' className='gap-1.5'>
          <Plus size={18} />
          Create Task
        </Button>
      </header>

      {/* Toolbar */}
      <div className='h-12 flex items-center justify-end gap-2 px-4 md:px-8 shrink-0 bg-white dark:bg-zinc-950 relative'>
        <DisplayOptionsMenu
          completedFilter={options.completedFilter}
          onCompletedFilterChange={setCompletedFilter}
          ordering={options.ordering}
          onOrderingChange={setOrdering}
          showSubtasks={options.showSubtasks}
          onShowSubtasksChange={setShowSubtasks}
        />
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>

      {/* Content */}
      <div className='flex-1 flex flex-col overflow-hidden'>
        <AsyncContent
          loading={loading}
          error={error}
          empty={filteredTasks.length === 0 && viewMode !== 'board'}
          onRetry={onRetry}
          className='flex-1 flex flex-col overflow-hidden'
          emptyState={
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <CheckSquare />
                </EmptyMedia>
                <EmptyTitle>No tasks yet</EmptyTitle>
                <EmptyDescription>
                  Tasks assigned to you will appear here.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => onNewTask()}>
                  <Plus size={16} />
                  Create Task
                </Button>
              </EmptyContent>
            </Empty>
          }
        >
          {viewMode === 'list' ? (
            <div className='flex-1 overflow-auto'>
              <TaskListTable
                tasks={filteredTasks}
                setTasks={setTasks}
                members={members}
                onTaskClick={onTaskClick}
                onRetry={onRetry}
              />
            </div>
          ) : (
            <BoardView
              tasks={filteredTasks}
              sensors={sensors}
              activeId={activeId}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragEnd={onDragEnd}
              orderingLabel={
                options.ordering !== 'manual'
                  ? ORDERING_LABELS[options.ordering]
                  : undefined
              }
              renderCard={(task, isOverlay) => (
                <MyTaskCard
                  key={task.id}
                  task={task}
                  isOverlay={isOverlay}
                  onClick={() => onTaskClick(task)}
                />
              )}
              onAddTask={status => onNewTask(status)}
            />
          )}
        </AsyncContent>
      </div>
    </div>
  )
}


// ─── TaskListTable ─────────────────────────────────────────────────────────────

function TaskListTable({
  tasks,
  setTasks,
  members,
  onTaskClick,
  onRetry,
}: {
  tasks: MyTask[]
  setTasks: React.Dispatch<React.SetStateAction<MyTask[]>>
  members: WorkspaceMemberInfo[]
  onTaskClick: (task: MyTask) => void
  onRetry: () => void
}) {
  const intl = useIntl()
  const { sort, toggle } = useTableSort<MyTaskSortKey>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const memberByActorId = useMemo(
    () =>
      new Map(
        members
          .filter(m => m.actorId)
          .map(m => [m.actorId!, m])
      ),
    [members]
  )

  const sorted = useMemo(() => {
    if (!sort.key) return tasks
    return [...tasks].sort((a, b) => {
      switch (sort.key) {
        case 'title':
          return applyDir(cmpString(a.title, b.title), sort.dir)
        case 'project':
          return applyDir(cmpString(a.project.name, b.project.name), sort.dir)
        case 'status':
          return applyDir(cmpStatus(a.status, b.status), sort.dir)
        case 'priority':
          return applyDir(cmpPriority(a.priority, b.priority), sort.dir)
        case 'assignee':
          return applyDir(
            cmpString(
              memberByActorId.get(a.assignee?.id ?? '')?.name ?? '',
              memberByActorId.get(b.assignee?.id ?? '')?.name ?? ''
            ),
            sort.dir
          )
        case 'owner':
          return applyDir(
            cmpString(
              memberByActorId.get(a.project.ownerActorId ?? '')?.name ?? '',
              memberByActorId.get(b.project.ownerActorId ?? '')?.name ?? ''
            ),
            sort.dir
          )
        case 'updatedAt':
          return applyDir(cmpDate(a.updatedAt, b.updatedAt), sort.dir)
        default:
          return 0
      }
    })
  }, [tasks, sort, memberByActorId])

  const visibleIds = useMemo(() => sorted.map(t => t.id), [sorted])
  const selectedVisibleCount = useMemo(
    () => visibleIds.filter(id => selected.has(id)).length,
    [visibleIds, selected]
  )
  const headerCheckboxState: boolean | 'indeterminate' =
    selectedVisibleCount === 0
      ? false
      : selectedVisibleCount === visibleIds.length
        ? true
        : 'indeterminate'

  const toggleAll = () => {
    setSelected(prev => {
      if (selectedVisibleCount === visibleIds.length) {
        const next = new Set(prev)
        visibleIds.forEach(id => next.delete(id))
        return next
      }
      const next = new Set(prev)
      visibleIds.forEach(id => next.add(id))
      return next
    })
  }

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runBulkUpdate = async (
    patch: Partial<{
      status: ApiStatus
      priority: ApiPriority
      assigneeActorId: string | null
    }>
  ) => {
    const ids = Array.from(selected)
    const results = await Promise.allSettled(
      ids.map(id => tasksClient.update(id, patch))
    )
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed > 0) {
      toast.error(
        `Failed to update ${failed} of ${ids.length} task${ids.length === 1 ? '' : 's'}`
      )
      onRetry()
    } else {
      const idSet = new Set(ids)
      setTasks(prev =>
        prev.map(t =>
          idSet.has(t.id)
            ? {
                ...t,
                ...(patch.status !== undefined ? { status: patch.status } : {}),
                ...(patch.priority !== undefined
                  ? { priority: patch.priority }
                  : {}),
                ...(patch.assigneeActorId !== undefined
                  ? { assigneeActorId: patch.assigneeActorId }
                  : {}),
              }
            : t
        )
      )
      toast.success(
        `Updated ${ids.length} task${ids.length === 1 ? '' : 's'}`
      )
    }
    setSelected(new Set())
  }

  const runBulkDelete = async () => {
    setDeleting(true)
    const ids = Array.from(selected)
    try {
      const results = await Promise.allSettled(
        ids.map(id => tasksClient.delete(id))
      )
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) {
        toast.error(
          `Failed to delete ${failed} of ${ids.length} task${ids.length === 1 ? '' : 's'}`
        )
        onRetry()
      } else {
        const idSet = new Set(ids)
        setTasks(prev => prev.filter(t => !idSet.has(t.id)))
        toast.success(
          `Deleted ${ids.length} task${ids.length === 1 ? '' : 's'}`
        )
      }
      setSelected(new Set())
    } finally {
      setDeleting(false)
      setConfirmDeleteOpen(false)
    }
  }

  const selectedCount = selected.size

  return (
    <>
      {/* Bulk-action bar — absolute overlay inside the h-12 toolbar slot */}
      {selectedCount > 0 && (
        <div className='fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-800 px-6 h-12'>
          <span className='text-xs font-medium text-zinc-700 dark:text-zinc-300'>
            {selectedCount} selected
          </span>
          <div className='flex items-center gap-2'>
            <BulkStatusPicker onPick={status => runBulkUpdate({ status })} />
            <BulkPriorityPicker
              onPick={priority => runBulkUpdate({ priority })}
            />
            <BulkAssigneePicker
              members={members}
              onPick={assigneeActorId =>
                runBulkUpdate({ assigneeActorId })
              }
            />
            <Button
              variant='destructive'
              size='sm'
              className='gap-1.5'
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 size={14} />
              Delete
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={() => setSelected(new Set())}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <table className='w-full border-collapse'>
        <thead className='sticky top-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-10'>
          <tr>
            <th className='py-2 px-4 w-10'>
              <Checkbox
                checked={headerCheckboxState}
                onCheckedChange={toggleAll}
                aria-label='Select all tasks'
              />
            </th>
            <SortableHeader
              col='title'
              label='Title'
              sort={sort}
              onToggle={toggle}
              className='text-left py-2 px-8 min-w-[300px]'
            />
            <SortableHeader
              col='project'
              label='Project'
              sort={sort}
              onToggle={toggle}
              className='text-left py-2 px-8 w-40'
            />
            <SortableHeader
              col='status'
              label='Status'
              sort={sort}
              onToggle={toggle}
              className='text-left py-2 px-8 w-32'
            />
            <SortableHeader
              col='priority'
              label='Priority'
              sort={sort}
              onToggle={toggle}
              className='text-left py-2 px-8 w-24'
            />
            <SortableHeader
              col='assignee'
              label='Assignee'
              sort={sort}
              onToggle={toggle}
              className='text-left py-2 px-8 w-24'
            />
            <SortableHeader
              col='owner'
              label={intl.formatMessage({
                id: 'project.owner',
                defaultMessage: 'Owner',
              })}
              sort={sort}
              onToggle={toggle}
              className='text-left py-2 px-8 w-24'
            />
            <SortableHeader
              col='updatedAt'
              label='Updated'
              sort={sort}
              onToggle={toggle}
              className='text-right py-2 px-8 pr-8'
            />
          </tr>
        </thead>
        <tbody className='divide-y divide-zinc-100 dark:divide-zinc-800'>
          {sorted.map(task => (
            <tr
              key={task.id}
              onClick={() => onTaskClick(task)}
              className='hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors cursor-pointer group'
            >
              <td
                className='py-2.5 px-4 border-b border-zinc-200 dark:border-zinc-800 w-10'
                onClick={e => e.stopPropagation()}
              >
                <Checkbox
                  checked={selected.has(task.id)}
                  onCheckedChange={() => toggleOne(task.id)}
                  aria-label={`Select task ${task.title}`}
                />
              </td>
              <td className='py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800'>
                <span className='text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-500 transition-colors'>
                  {task.title}
                </span>
              </td>
              <td className='py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800'>
                <span className='text-xs text-zinc-500 dark:text-zinc-400'>
                  {task.project.name}
                </span>
              </td>
              <td className='py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800'>
                <div className='flex items-center gap-2'>
                  <StatusIcon status={task.status} />
                  <span className='text-xs text-zinc-600 dark:text-zinc-400'>
                    {API_STATUS_LABEL[task.status] ?? task.status}
                  </span>
                </div>
              </td>
              <td className='py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800'>
                <PriorityBadge priority={task.priority} />
              </td>
              <td className='py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800'>
                {(() => {
                  const m = task.assignee?.id
                    ? memberByActorId.get(task.assignee.id)
                    : null
                  return m ? (
                    <MemberAvatar member={m} />
                  ) : (
                    <span className='text-xs text-zinc-400'>—</span>
                  )
                })()}
              </td>
              <td className='py-2.5 px-8 border-b border-zinc-200 dark:border-zinc-800'>
                {(() => {
                  const m = task.project.ownerActorId
                    ? memberByActorId.get(task.project.ownerActorId)
                    : null
                  return m ? (
                    <MemberAvatar member={m} />
                  ) : (
                    <span className='text-xs text-zinc-400'>—</span>
                  )
                })()}
              </td>
              <td className='py-2.5 px-8 text-xs text-zinc-400 text-right border-b border-zinc-200 dark:border-zinc-800 pr-8'>
                {new Date(task.updatedAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Delete confirmation dialog */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tasks?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedCount} task
              {selectedCount === 1 ? '' : 's'}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={runBulkDelete}
              disabled={deleting}
              className='bg-red-600 hover:bg-red-700 focus:ring-red-600'
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

// ─── Bulk pickers ──────────────────────────────────────────────────────────────

function BulkStatusPicker({ onPick }: { onPick: (s: ApiStatus) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          Status
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-48 p-0' align='end'>
        <Command>
          <CommandList>
            {(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const).map(
              s => (
                <CommandItem
                  key={s}
                  onSelect={() => {
                    onPick(s)
                    setOpen(false)
                  }}
                  className='gap-2'
                >
                  <StatusIcon status={s} />
                  {API_STATUS_LABEL[s] ?? s}
                </CommandItem>
              )
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function BulkPriorityPicker({
  onPick,
}: {
  onPick: (p: ApiPriority) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          Priority
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-48 p-0' align='end'>
        <Command>
          <CommandList>
            {(['URGENT', 'HIGH', 'MEDIUM', 'LOW'] as const).map(p => {
              const { label, Icon, iconColor } = PRIORITY_CONFIG[p]
              return (
                <CommandItem
                  key={p}
                  onSelect={() => {
                    onPick(p)
                    setOpen(false)
                  }}
                  className='gap-2'
                >
                  <span className={iconColor}>
                    <Icon className='size-4' />
                  </span>
                  {label}
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function BulkAssigneePicker({
  members,
  onPick,
}: {
  members: WorkspaceMemberInfo[]
  onPick: (actorId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const assignableMembers = members.filter(m => m.actorId)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          Assignee
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-56 p-0' align='end'>
        <Command>
          <CommandInput placeholder='Search members…' />
          <CommandList>
            <CommandItem
              onSelect={() => {
                onPick(null)
                setOpen(false)
              }}
              className='gap-2 text-zinc-400'
            >
              Unassigned
            </CommandItem>
            {assignableMembers.map(m => (
              <CommandItem
                key={m.actorId}
                onSelect={() => {
                  onPick(m.actorId)
                  setOpen(false)
                }}
                className='gap-2'
              >
                <MemberAvatar member={m} size='xs' />
                {m.name}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
