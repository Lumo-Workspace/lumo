'use client'

import { useState, useMemo } from 'react'
import { useIntl } from 'react-intl'
import { Plus, CheckSquare, Trash2, ChevronDown } from 'lucide-react'
import {
  MyTask,
  ApiStatus,
  ApiPriority,
  WorkspaceMemberInfo,
} from '../../types'
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

  // ─── Selection state (lifted up so bar can render in toolbar slot) ──────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

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
        intl.formatMessage(
          {
            id: 'task.bulkUpdateFailure',
            defaultMessage: 'Failed to update {failed} of {total} tasks',
          },
          { failed, total: ids.length }
        )
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
        intl.formatMessage(
          {
            id: 'task.bulkUpdateSuccess',
            defaultMessage:
              'Updated {count, plural, one {# task} other {# tasks}}',
          },
          { count: ids.length }
        )
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
          intl.formatMessage(
            {
              id: 'task.bulkDeleteFailure',
              defaultMessage: 'Failed to delete {failed} of {total} tasks',
            },
            { failed, total: ids.length }
          )
        )
        onRetry()
      } else {
        const idSet = new Set(ids)
        setTasks(prev => prev.filter(t => !idSet.has(t.id)))
        toast.success(
          intl.formatMessage(
            {
              id: 'task.bulkDeleteSuccess',
              defaultMessage:
                'Deleted {count, plural, one {# task} other {# tasks}}',
            },
            { count: ids.length }
          )
        )
      }
      setSelected(new Set())
    } finally {
      setDeleting(false)
      setConfirmDeleteOpen(false)
    }
  }

  return (
    <div className='flex-1 flex flex-col overflow-hidden'>
      {/* Page header */}
      <header className='pt-4 pb-4 px-4 md:px-8 flex items-center justify-between shrink-0'>
        <h1 className='text-lg font-semibold text-zinc-900 dark:text-zinc-100'>
          {intl.formatMessage({ id: 'sidebar.myTasks' })}
        </h1>
        <Button onClick={() => onNewTask()} size='sm' className='gap-1.5'>
          <Plus size={18} />
          {intl.formatMessage({
            id: 'task.create',
            defaultMessage: 'Create Task',
          })}
        </Button>
      </header>

      {/* Toolbar — relative so the selection bar can absolute-overlay it */}
      <div className='h-12 shrink-0 relative bg-white dark:bg-zinc-950'>
        <div className='h-12 flex items-center justify-end gap-2 px-4 md:px-8'>
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
        {selected.size > 0 && (
          <div className='absolute inset-0 z-20 flex items-center justify-between gap-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 px-6'>
            <span className='text-xs font-medium text-zinc-700 dark:text-zinc-300'>
              {intl.formatMessage(
                { id: 'common.selected', defaultMessage: '{count} selected' },
                { count: selected.size }
              )}
            </span>
            <div className='flex items-center gap-2'>
              <BulkStatusPicker onPick={status => runBulkUpdate({ status })} />
              <BulkPriorityPicker
                onPick={priority => runBulkUpdate({ priority })}
              />
              <BulkAssigneePicker
                members={members}
                onPick={assigneeActorId => runBulkUpdate({ assigneeActorId })}
              />
              <Button
                variant='destructive'
                size='sm'
                className='gap-1.5'
                onClick={() => setConfirmDeleteOpen(true)}
              >
                <Trash2 size={14} />
                {intl.formatMessage({
                  id: 'common.delete',
                  defaultMessage: 'Delete',
                })}
              </Button>
              <Button
                variant='ghost'
                size='sm'
                onClick={() => setSelected(new Set())}
              >
                {intl.formatMessage({
                  id: 'common.cancel',
                  defaultMessage: 'Cancel',
                })}
              </Button>
            </div>
          </div>
        )}
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
                <EmptyTitle>
                  {intl.formatMessage({
                    id: 'task.empty.title',
                    defaultMessage: 'No tasks yet',
                  })}
                </EmptyTitle>
                <EmptyDescription>
                  {intl.formatMessage({
                    id: 'task.empty.description',
                    defaultMessage: 'Tasks assigned to you will appear here.',
                  })}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => onNewTask()}>
                  <Plus size={16} />
                  {intl.formatMessage({
                    id: 'task.create',
                    defaultMessage: 'Create Task',
                  })}
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
                selected={selected}
                setSelected={setSelected}
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

      {/* Delete confirmation dialog */}
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {intl.formatMessage({
                id: 'task.bulkDeleteConfirmTitle',
                defaultMessage: 'Delete tasks?',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {intl.formatMessage(
                {
                  id: 'task.bulkDeleteConfirmDesc',
                  defaultMessage:
                    'This will permanently delete {count, plural, one {# task} other {# tasks}}. This action cannot be undone.',
                },
                { count: selected.size }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {intl.formatMessage({
                id: 'common.cancel',
                defaultMessage: 'Cancel',
              })}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={runBulkDelete}
              disabled={deleting}
              className='bg-red-600 hover:bg-red-700 focus:ring-red-600'
            >
              {deleting
                ? intl.formatMessage({
                    id: 'common.deleting',
                    defaultMessage: 'Deleting…',
                  })
                : intl.formatMessage({
                    id: 'common.delete',
                    defaultMessage: 'Delete',
                  })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  selected,
  setSelected,
}: {
  tasks: MyTask[]
  setTasks: React.Dispatch<React.SetStateAction<MyTask[]>>
  members: WorkspaceMemberInfo[]
  onTaskClick: (task: MyTask) => void
  onRetry: () => void
  selected: Set<string>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
}) {
  const intl = useIntl()
  const { sort, toggle } = useTableSort<MyTaskSortKey>()

  const memberByActorId = useMemo(
    () => new Map(members.filter(m => m.actorId).map(m => [m.actorId!, m])),
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

  // suppress unused-var lint for setTasks — kept in props for future use
  void setTasks
  // suppress unused-var lint for onRetry — kept in props for future use
  void onRetry

  return (
    <table className='w-full border-collapse'>
      <thead className='sticky top-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-10'>
        <tr>
          <th className='py-2 px-4 w-10'>
            <Checkbox
              checked={headerCheckboxState}
              onCheckedChange={toggleAll}
              aria-label={intl.formatMessage({
                id: 'task.selectAll',
                defaultMessage: 'Select all tasks',
              })}
            />
          </th>
          <SortableHeader
            col='title'
            label={intl.formatMessage({
              id: 'task.title',
              defaultMessage: 'Title',
            })}
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8 min-w-[300px]'
          />
          <SortableHeader
            col='project'
            label={intl.formatMessage({
              id: 'task.project',
              defaultMessage: 'Project',
            })}
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8 w-40'
          />
          <SortableHeader
            col='status'
            label={intl.formatMessage({
              id: 'task.status',
              defaultMessage: 'Status',
            })}
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8 w-32'
          />
          <SortableHeader
            col='priority'
            label={intl.formatMessage({
              id: 'task.priority',
              defaultMessage: 'Priority',
            })}
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8 w-24'
          />
          <SortableHeader
            col='assignee'
            label={intl.formatMessage({
              id: 'task.assignee',
              defaultMessage: 'Assignee',
            })}
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
            label={intl.formatMessage({
              id: 'common.updated',
              defaultMessage: 'Updated',
            })}
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
                aria-label={intl.formatMessage(
                  { id: 'task.selectOne', defaultMessage: 'Select {title}' },
                  { title: task.title }
                )}
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
  )
}

// ─── Bulk pickers ──────────────────────────────────────────────────────────────

function BulkStatusPicker({ onPick }: { onPick: (s: ApiStatus) => void }) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          {intl.formatMessage({ id: 'task.status', defaultMessage: 'Status' })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-48 p-0' align='end'>
        <Command>
          <CommandList>
            {(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const).map(s => (
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
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function BulkPriorityPicker({ onPick }: { onPick: (p: ApiPriority) => void }) {
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          {intl.formatMessage({
            id: 'task.priority',
            defaultMessage: 'Priority',
          })}
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
  const intl = useIntl()
  const [open, setOpen] = useState(false)
  const assignableMembers = members.filter(m => m.actorId)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant='ghost' size='sm' className='gap-1.5'>
          <ChevronDown size={14} />
          {intl.formatMessage({
            id: 'task.assignee',
            defaultMessage: 'Assignee',
          })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-56 p-0' align='end'>
        <Command>
          <CommandInput
            placeholder={intl.formatMessage({
              id: 'member.searchPlaceholder',
              defaultMessage: 'Search members…',
            })}
          />
          <CommandList>
            <CommandItem
              onSelect={() => {
                onPick(null)
                setOpen(false)
              }}
              className='gap-2 text-zinc-400'
            >
              {intl.formatMessage({
                id: 'task.unassigned',
                defaultMessage: 'Unassigned',
              })}
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
