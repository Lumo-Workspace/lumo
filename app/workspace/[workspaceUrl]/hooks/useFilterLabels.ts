'use client'

import { useMemo } from 'react'
import { useIntl } from 'react-intl'
import type { WorkspaceMemberInfo } from '../types'
import {
  NO_MILESTONE_VALUE,
  NO_SPRINT_VALUE,
  UNASSIGNED_VALUE,
  UNTAGGED_VALUE,
  type FilterableTask,
  type FilterDimension,
} from '../utils/filterTasks'

/**
 * Human labels for filter dimensions and their values.
 *
 * Value labels are resolved from the tasks in scope (project names, tag names)
 * plus the member list (assignee names) — so the filter control needs no
 * separate projects/tags fetch, and never shows a value the board can't show.
 */
export function useFilterLabels(
  tasks: FilterableTask[],
  members: WorkspaceMemberInfo[]
) {
  const intl = useIntl()

  const dimensionLabel = useMemo(() => {
    const labels: Record<FilterDimension, string> = {
      status: intl.formatMessage({
        id: 'filter.dimension.status',
        defaultMessage: 'Status',
      }),
      priority: intl.formatMessage({
        id: 'filter.dimension.priority',
        defaultMessage: 'Priority',
      }),
      assignee: intl.formatMessage({
        id: 'filter.dimension.assignee',
        defaultMessage: 'Assignee',
      }),
      project: intl.formatMessage({
        id: 'filter.dimension.project',
        defaultMessage: 'Project',
      }),
      milestone: intl.formatMessage({
        id: 'filter.dimension.milestone',
        defaultMessage: 'Milestone',
      }),
      sprint: intl.formatMessage({
        id: 'filter.dimension.sprint',
        defaultMessage: 'Sprint',
      }),
      tag: intl.formatMessage({
        id: 'filter.dimension.tag',
        defaultMessage: 'Label',
      }),
      dueDate: intl.formatMessage({
        id: 'filter.dimension.dueDate',
        defaultMessage: 'Due date',
      }),
    }
    return (dimension: FilterDimension) => labels[dimension]
  }, [intl])

  const valueLabel = useMemo(() => {
    const statusLabels: Record<string, string> = {
      BACKLOG: intl.formatMessage({
        id: 'status.backlog',
        defaultMessage: 'Backlog',
      }),
      TODO: intl.formatMessage({ id: 'status.todo', defaultMessage: 'Todo' }),
      IN_PROGRESS: intl.formatMessage({
        id: 'status.inProgress',
        defaultMessage: 'In Progress',
      }),
      IN_REVIEW: intl.formatMessage({
        id: 'status.inReview',
        defaultMessage: 'In Review',
      }),
      DONE: intl.formatMessage({ id: 'status.done', defaultMessage: 'Done' }),
    }
    const priorityLabels: Record<string, string> = {
      URGENT: intl.formatMessage({
        id: 'priority.urgent',
        defaultMessage: 'Urgent',
      }),
      HIGH: intl.formatMessage({ id: 'priority.high', defaultMessage: 'High' }),
      MEDIUM: intl.formatMessage({
        id: 'priority.medium',
        defaultMessage: 'Medium',
      }),
      LOW: intl.formatMessage({ id: 'priority.low', defaultMessage: 'Low' }),
      NONE: intl.formatMessage({
        id: 'priority.none',
        defaultMessage: 'No priority',
      }),
    }
    const dueDateLabels: Record<string, string> = {
      overdue: intl.formatMessage({
        id: 'filter.dueDate.overdue',
        defaultMessage: 'Overdue',
      }),
      today: intl.formatMessage({
        id: 'filter.dueDate.today',
        defaultMessage: 'Today',
      }),
      next7: intl.formatMessage({
        id: 'filter.dueDate.next7',
        defaultMessage: 'Next 7 days',
      }),
      later: intl.formatMessage({
        id: 'filter.dueDate.later',
        defaultMessage: 'Later',
      }),
      none: intl.formatMessage({
        id: 'filter.dueDate.none',
        defaultMessage: 'No due date',
      }),
    }

    const projectNames = new Map<string, string>()
    const tagNames = new Map<string, string>()
    const sprintNames = new Map<string, string>()
    const milestoneNames = new Map<string, string>()
    for (const task of tasks) {
      if (task.project?.name)
        projectNames.set(task.projectId, task.project.name)
      for (const tag of task.tags ?? []) tagNames.set(tag.id, tag.name)
      if (task.sprintId && task.sprint?.name) {
        sprintNames.set(task.sprintId, task.sprint.name)
      }
      if (task.milestoneId && task.milestone?.name) {
        milestoneNames.set(task.milestoneId, task.milestone.name)
      }
    }
    const memberNames = new Map<string, string>()
    for (const member of members) {
      if (member.actorId) memberNames.set(member.actorId, member.name)
    }
    const agentNames = new Map<string, string>()
    for (const task of tasks) {
      const actor = task.assignee
      if (actor?.agent?.name && task.assigneeActorId) {
        agentNames.set(task.assigneeActorId, actor.agent.name)
      }
    }

    const unassigned = intl.formatMessage({
      id: 'filter.unassigned',
      defaultMessage: 'Unassigned',
    })
    const untagged = intl.formatMessage({
      id: 'filter.untagged',
      defaultMessage: 'No label',
    })
    const noSprint = intl.formatMessage({
      id: 'filter.noSprint',
      defaultMessage: 'No sprint',
    })
    const noMilestone = intl.formatMessage({
      id: 'filter.noMilestone',
      defaultMessage: 'No milestone',
    })

    return (dimension: FilterDimension, value: string): string => {
      switch (dimension) {
        case 'status':
          return statusLabels[value] ?? value
        case 'priority':
          return priorityLabels[value] ?? value
        case 'dueDate':
          return dueDateLabels[value] ?? value
        case 'project':
          return projectNames.get(value) ?? value
        case 'sprint':
          return value === NO_SPRINT_VALUE
            ? noSprint
            : (sprintNames.get(value) ?? noSprint)
        case 'milestone':
          return value === NO_MILESTONE_VALUE
            ? noMilestone
            : (milestoneNames.get(value) ?? noMilestone)
        case 'tag':
          return value === UNTAGGED_VALUE
            ? untagged
            : (tagNames.get(value) ?? value)
        case 'assignee':
          return value === UNASSIGNED_VALUE
            ? unassigned
            : (memberNames.get(value) ?? agentNames.get(value) ?? unassigned)
      }
    }
  }, [intl, tasks, members])

  return { dimensionLabel, valueLabel }
}
