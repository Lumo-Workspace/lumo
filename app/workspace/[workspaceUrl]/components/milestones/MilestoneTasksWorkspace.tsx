'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useIntl } from 'react-intl'
import { CheckSquare } from 'lucide-react'
import type { RowSelectionState } from '@tanstack/react-table'
import { toast } from 'sonner'
import { tasksClient } from '@/lib/api-client'
import type { ApiTask, MyTask } from '../../types'
import type { TaskPatch } from '../data-table/task-columns'
import type { ColumnId } from '../data-table/columnTemplate'
import { useMilestoneTasks } from '../../hooks/useMilestoneTasks'
import { useMembers } from '../../hooks/useMembers'
import { useProjects } from '../../hooks/useProjects'
import { useTaskBulkMutations } from '../../hooks/useTaskBulkMutations'
import { AsyncContent } from '../AsyncContent'
import { TaskTableSkeleton } from '../skeletons/TaskSkeletons'
import { TaskListView } from '../task-list/TaskListView'
import { BulkActionBar } from '../task-list/BulkActionBar'
import { BulkDeleteConfirm } from '../task-list/BulkDeleteConfirm'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

// Same column set the project list shows, plus PROJECT (a milestone can span
// projects). Module-level so TaskListView's columns memo stays stable.
const COLUMNS: ColumnId[] = [
  'select',
  'identifier',
  'title',
  'project',
  'status',
  'priority',
  'dueDate',
  'assignee',
  'updatedAt',
  'actions',
]

interface MilestoneTasksWorkspaceProps {
  milestoneId: string
  /** Open the task drawer for a clicked row. */
  onOpenTask: (task: MyTask) => void
}

/**
 * The milestone's task list: every task in the milestone, in one table, with
 * the shared row behaviour (inline edits, row selection + bulk actions, the
 * per-row actions menu). LUM-727 — no toolbar above it: no filter menu, no
 * completed/ordering display options, no board toggle. The milestone
 * scope is the filter, so the list always shows the whole milestone, DONE
 * tasks included. It grows with the page (`flow`) so the single-page layout
 * never nests a second scrollbar.
 *
 * No "Add task" affordance: NewTaskModal can't pre-bind a milestone, so tasks
 * join a milestone from task detail or the CLI.
 */
export function MilestoneTasksWorkspace({
  milestoneId,
  onOpenTask,
}: MilestoneTasksWorkspaceProps) {
  const intl = useIntl()
  const { tasks, isLoading, error, refetch } = useMilestoneTasks(milestoneId)
  const { members } = useMembers()
  const { projects, fetchProjects } = useProjects()

  // Mirror fetched tasks into local state so this view owns the source of
  // truth for inline edits between refetches (same as the sprint board).
  const [localTasks, setLocalTasks] = useState<MyTask[]>([])
  useEffect(() => {
    setLocalTasks((tasks ?? []) as MyTask[])
  }, [tasks])

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const {
    confirmDeleteOpen,
    setConfirmDeleteOpen,
    deleting,
    runBulkUpdate,
    runBulkDelete,
  } = useTaskBulkMutations({
    tasks: localTasks,
    selected,
    setSelected,
    setTasks: setLocalTasks,
    onRetry: refetch,
  })

  // ─── Selection bridge: Set (source of truth) ↔ table RowSelectionState ─────
  const rowSelection = useMemo<RowSelectionState>(
    () => Object.fromEntries([...selected].map(id => [id, true])),
    [selected]
  )
  const handleRowSelectionChange = useCallback(
    (next: RowSelectionState) =>
      setSelected(new Set(Object.keys(next).filter(id => next[id]))),
    []
  )

  const updateTask = useCallback(
    async (id: string, patch: TaskPatch) => {
      setLocalTasks(prev =>
        prev.map(t => {
          if (t.id !== id) return t
          // A project change also refreshes the embedded project so the row
          // updates without waiting for a refetch.
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
        refetch()
      }
    },
    [projects, refetch]
  )

  const handleDeleteTask = useCallback(
    async (taskId: string) => {
      setLocalTasks(prev => prev.filter(t => t.id !== taskId))
      try {
        await tasksClient.delete(taskId)
      } catch {
        toast.error('Failed to delete task')
        refetch()
      }
    },
    [refetch]
  )

  // Rows are MyTask; the table types as ApiTask.
  const handleTaskClick = useCallback(
    (task: ApiTask) => onOpenTask(task as MyTask),
    [onOpenTask]
  )

  return (
    <div className='flex flex-col'>
      {/* The bulk bar only claims a row while something is selected — with no
          toolbar there is nothing to overlay the rest of the time. */}
      {selected.size > 0 && (
        <div className='relative h-12 shrink-0'>
          <BulkActionBar
            count={selected.size}
            members={members}
            onBulkUpdate={runBulkUpdate}
            onRequestDelete={() => setConfirmDeleteOpen(true)}
            onClearSelection={() => setSelected(new Set())}
          />
        </div>
      )}

      <AsyncContent
        loading={isLoading}
        error={error ? (error.message ?? 'Could not load tasks.') : null}
        empty={localTasks.length === 0}
        onRetry={refetch}
        loadingState={<TaskTableSkeleton rows={5} />}
        className='flex flex-col'
        emptyState={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <CheckSquare />
              </EmptyMedia>
              <EmptyTitle>
                {intl.formatMessage({ id: 'milestone.tasks.empty' })}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        }
      >
        <TaskListView
          tasks={localTasks}
          members={members}
          projects={projects}
          visibleColumns={COLUMNS}
          updateTask={updateTask}
          onTaskClick={handleTaskClick}
          onDeleteTask={handleDeleteTask}
          rowSelection={rowSelection}
          onRowSelectionChange={handleRowSelectionChange}
          flow
        />
      </AsyncContent>

      <BulkDeleteConfirm
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        count={selected.size}
        deleting={deleting}
        onConfirm={runBulkDelete}
      />
    </div>
  )
}
