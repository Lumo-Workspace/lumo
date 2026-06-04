'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { useIntl } from 'react-intl'
import { ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { tasksClient } from '@/lib/api-client'
import {
  shouldVirtualize,
  LIST_VIRTUALIZE_THRESHOLD,
} from '@/lib/utils/shouldVirtualize'
import type {
  ApiPriority,
  ApiProject,
  ApiStatus,
  MyTask,
  WorkspaceMemberInfo,
} from '../../types'
import {
  applyDir,
  cmpDate,
  cmpPriority,
  cmpStatus,
  cmpString,
  useTableSort,
} from '../../hooks/useTableSort'
import { SortableHeader } from '../SortableHeader'
import { AssigneeSelect } from '../fields/AssigneeSelect'
import { PrioritySelect } from '../fields/PrioritySelect'
import { ProjectSelect } from '../fields/ProjectSelect'
import { StatusSelect } from '../fields/StatusSelect'

type TaskSortKey =
  | 'title'
  | 'project'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'updatedAt'

const GHOST_TRIGGER =
  'h-7 px-2 border-0 bg-transparent hover:bg-zinc-100 dark:hover:bg-zinc-800 shadow-none text-xs'

const COLUMN_TEMPLATE = '40px minmax(300px, 1fr) 160px 128px 96px 96px 140px'
const ROW_HEIGHT = 49 // px — rows are single-line (TitleCell truncates)

// ─── Inline title cell ─────────────────────────────────────────────────────────

function TitleCell({
  task,
  onCommit,
  onDetailsClick,
}: {
  task: MyTask
  onCommit: (title: string) => void
  onDetailsClick: () => void
}) {
  const intl = useIntl()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = useCallback(() => {
    setDraft(task.title)
    setEditing(true)
    // focus happens via autoFocus / useEffect after render
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
        className='w-full text-sm font-medium bg-transparent border-0 outline-none focus:ring-0 text-zinc-900 dark:text-zinc-100'
        onClick={e => e.stopPropagation()}
      />
    )
  }

  return (
    <div className='flex items-center justify-between gap-2 group/title'>
      <span
        className='text-sm font-medium text-zinc-900 dark:text-zinc-100 group-hover:text-blue-500 transition-colors cursor-text flex-1 min-w-0 truncate'
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
            className='size-6 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-300 hover:text-zinc-600 dark:hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0'
            aria-label={intl.formatMessage({
              id: 'task.openDetails',
              defaultMessage: 'Open details',
            })}
          >
            <ChevronRight size={14} />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {intl.formatMessage({
            id: 'task.openDetails',
            defaultMessage: 'Open details',
          })}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

// ─── TaskListTable ─────────────────────────────────────────────────────────────

interface Props {
  tasks: MyTask[]
  setTasks: React.Dispatch<React.SetStateAction<MyTask[]>>
  members: WorkspaceMemberInfo[]
  projects: ApiProject[]
  onTaskClick: (task: MyTask) => void
  onRetry: () => void
  selected: Set<string>
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
}

export function TaskListTable({
  tasks,
  setTasks,
  members,
  projects,
  onTaskClick,
  onRetry,
  selected,
  setSelected,
}: Props) {
  const intl = useIntl()
  const { sort, toggle } = useTableSort<TaskSortKey>()

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

  // ─── Single-row inline update ────────────────────────────────────────────────
  const updateTask = useCallback(
    async (
      id: string,
      patch: Partial<{
        title: string
        status: ApiStatus
        priority: ApiPriority
        assigneeActorId: string | null
        projectId: string
      }>
    ) => {
      setTasks(prev =>
        prev.map(t => {
          if (t.id !== id) return t
          // When project changes, also refresh the embedded { id, name, ownerActorId }
          // so the row updates without waiting for a refetch.
          if (patch.projectId && patch.projectId !== t.projectId) {
            const np = projects.find(p => p.id === patch.projectId)
            return {
              ...t,
              ...patch,
              project: np
                ? {
                    id: np.id,
                    name: np.name,
                    ownerActorId:
                      (np as { ownerActorId?: string | null }).ownerActorId ??
                      null,
                  }
                : t.project,
            }
          }
          return { ...t, ...patch }
        })
      )
      try {
        await tasksClient.update(id, patch)
      } catch {
        toast.error('Failed to update task')
        onRetry()
      }
    },
    [setTasks, projects, onRetry]
  )

  const assignableMembers = useMemo(
    () =>
      members.filter(
        (m): m is WorkspaceMemberInfo & { actorId: string } => !!m.actorId
      ),
    [members]
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = shouldVirtualize(sorted.length, LIST_VIRTUALIZE_THRESHOLD)

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtualize,
  })

  const renderRow = (task: MyTask) => (
    <div
      role='row'
      className='grid items-center hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors group border-b border-zinc-200 dark:border-zinc-800'
      style={{ gridTemplateColumns: COLUMN_TEMPLATE, height: ROW_HEIGHT }}
    >
      <div role='cell' className='px-4' onClick={e => e.stopPropagation()}>
        <Checkbox
          checked={selected.has(task.id)}
          onCheckedChange={() => toggleOne(task.id)}
          aria-label={intl.formatMessage(
            { id: 'task.selectOne', defaultMessage: 'Select {title}' },
            { title: task.title }
          )}
        />
      </div>
      <div role='cell' className='px-8 min-w-0'>
        <TitleCell
          task={task}
          onCommit={title => updateTask(task.id, { title })}
          onDetailsClick={() => onTaskClick(task)}
        />
      </div>
      <div
        role='cell'
        className='px-8 min-w-0'
        onClick={e => e.stopPropagation()}
      >
        <ProjectSelect
          value={task.projectId}
          projects={projects}
          onChange={projectId => updateTask(task.id, { projectId })}
          triggerClassName={GHOST_TRIGGER}
        />
      </div>
      <div role='cell' className='px-8' onClick={e => e.stopPropagation()}>
        <StatusSelect
          value={task.status}
          onChange={status => updateTask(task.id, { status })}
          triggerClassName={GHOST_TRIGGER}
        />
      </div>
      <div role='cell' className='px-8' onClick={e => e.stopPropagation()}>
        <PrioritySelect
          value={task.priority}
          onChange={priority => updateTask(task.id, { priority })}
          triggerClassName={GHOST_TRIGGER}
        />
      </div>
      <div role='cell' className='px-8' onClick={e => e.stopPropagation()}>
        <AssigneeSelect
          value={task.assigneeActorId}
          onChange={assigneeActorId => updateTask(task.id, { assigneeActorId })}
          members={assignableMembers}
          assignee={task.assignee ?? null}
          triggerClassName={GHOST_TRIGGER}
        />
      </div>
      <div role='cell' className='px-8 pr-8 text-xs text-zinc-400 text-right'>
        {new Date(task.updatedAt).toLocaleDateString()}
      </div>
    </div>
  )

  return (
    <div ref={scrollRef} role='table' className='flex-1 min-h-0 overflow-auto'>
      {/* Sticky header */}
      <div role='rowgroup'>
        <div
          role='row'
          className='grid sticky top-0 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm z-10 border-b border-zinc-200 dark:border-zinc-800'
          style={{ gridTemplateColumns: COLUMN_TEMPLATE }}
        >
          <div role='columnheader' className='py-2 px-4'>
            <Checkbox
              checked={headerCheckboxState}
              onCheckedChange={toggleAll}
              aria-label={intl.formatMessage({
                id: 'task.selectAll',
                defaultMessage: 'Select all tasks',
              })}
            />
          </div>
          <SortableHeader
            col='title'
            label={intl.formatMessage({
              id: 'task.title',
              defaultMessage: 'Title',
            })}
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8'
            tooltip={intl.formatMessage({
              id: 'tasks.tooltip.title',
              defaultMessage: 'Task title.',
            })}
            as='div'
          />
          <SortableHeader
            col='project'
            label={intl.formatMessage({
              id: 'task.project',
              defaultMessage: 'Project',
            })}
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8'
            tooltip={intl.formatMessage({
              id: 'tasks.tooltip.project',
              defaultMessage: 'Project this task belongs to.',
            })}
            as='div'
          />
          <SortableHeader
            col='status'
            label={intl.formatMessage({
              id: 'task.status',
              defaultMessage: 'Status',
            })}
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8'
            tooltip={intl.formatMessage({
              id: 'tasks.tooltip.status',
              defaultMessage:
                'Workflow stage: To Do, In Progress, In Review, or Done.',
            })}
            as='div'
          />
          <SortableHeader
            col='priority'
            label={intl.formatMessage({
              id: 'task.priority',
              defaultMessage: 'Priority',
            })}
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8'
            tooltip={intl.formatMessage({
              id: 'tasks.tooltip.priority',
              defaultMessage: 'Priority level: Urgent, High, Medium, or Low.',
            })}
            as='div'
          />
          <SortableHeader
            col='assignee'
            label={intl.formatMessage({
              id: 'task.assignee',
              defaultMessage: 'Assignee',
            })}
            sort={sort}
            onToggle={toggle}
            className='text-left py-2 px-8'
            tooltip={intl.formatMessage({
              id: 'tasks.tooltip.assignee',
              defaultMessage: 'Person responsible for completing this task.',
            })}
            as='div'
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
            tooltip={intl.formatMessage({
              id: 'tasks.tooltip.updated',
              defaultMessage: 'Last time this task was modified.',
            })}
            as='div'
          />
        </div>
      </div>

      {/* Body */}
      {virtualize ? (
        <div
          role='rowgroup'
          style={{
            height: rowVirtualizer.getTotalSize(),
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map(vi => {
            const task = sorted[vi.index]
            if (!task) return null
            return (
              <div
                key={task.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {renderRow(task)}
              </div>
            )
          })}
        </div>
      ) : (
        <div role='rowgroup'>
          {sorted.map(task => (
            <div key={task.id}>{renderRow(task)}</div>
          ))}
        </div>
      )}
    </div>
  )
}
