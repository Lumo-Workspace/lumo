'use client'

import { useEffect, useState } from 'react'
import { useIntl } from 'react-intl'
import { CheckSquare } from 'lucide-react'
import type { MyTask } from '../../types'
import { useMilestoneTasks } from '../../hooks/useMilestoneTasks'
import { useMembers } from '../../hooks/useMembers'
import { useProjects } from '../../hooks/useProjects'
import { TaskWorkspaceView } from '../task-list/TaskWorkspaceView'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

interface MilestoneTasksWorkspaceProps {
  milestoneId: string
  /** Collapse state of the milestone properties rail (owned by the page). */
  sidebarCollapsed: boolean
  onToggleSidebar: () => void
  /** Open the task drawer for a clicked card/row. */
  onOpenTask: (task: MyTask) => void
}

/**
 * The milestone detail task list. Loads the milestone's tasks (MyTask-shaped)
 * and renders the shared {@link TaskWorkspaceView} — the same toolbar,
 * filters, bulk actions and inline edits the project list has. LUM-727: the
 * milestone page is a single scrolling page, so the workspace runs list-only
 * (no board toggle) and grows with the page instead of nesting a scrollbar.
 * No "Add task" affordance: NewTaskModal can't pre-bind a milestone, so tasks
 * join a milestone from task detail or the CLI.
 */
export function MilestoneTasksWorkspace({
  milestoneId,
  sidebarCollapsed,
  onToggleSidebar,
  onOpenTask,
}: MilestoneTasksWorkspaceProps) {
  const intl = useIntl()
  const { tasks, isLoading, error, refetch } = useMilestoneTasks(milestoneId)
  const { members } = useMembers()
  const { projects, fetchProjects } = useProjects()

  // Mirror fetched tasks into local state so the workspace owns the source of
  // truth for inline edits + DnD between refetches (same as the sprint page).
  const [localTasks, setLocalTasks] = useState<MyTask[]>([])
  useEffect(() => {
    setLocalTasks((tasks ?? []) as MyTask[])
  }, [tasks])

  useEffect(() => {
    void fetchProjects()
  }, [fetchProjects])

  return (
    <TaskWorkspaceView
      tasks={localTasks}
      setTasks={setLocalTasks}
      loading={isLoading}
      error={error ? (error.message ?? 'Could not load tasks.') : null}
      onRetry={refetch}
      onTaskClick={onOpenTask}
      members={members}
      projects={projects}
      displayOptionsKey={`lumo:display:milestone:${milestoneId}`}
      enableBoard={false}
      defaultViewMode='list'
      layout='flow'
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={onToggleSidebar}
      sidebarExpandLabel={intl.formatMessage({
        id: 'milestone.detail.expandSidebar',
      })}
      sidebarCollapseLabel={intl.formatMessage({
        id: 'milestone.detail.collapseSidebar',
      })}
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
    />
  )
}
