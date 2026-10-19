'use client'

import { useIntl } from 'react-intl'
import type {
  TaskDetail,
  WorkspaceMemberInfo,
  ApiProject,
  ApiTag,
} from '../types'
import {
  StatusSelect,
  AssigneeSelect,
  ProjectSelect,
  PrioritySelect,
  FIELD_TRIGGER_CLS,
} from './fields'
import { TagPicker } from './document/TagPicker'
import { TaskSprintField } from '../sprints/components/TaskSprintField'
import { TaskMilestoneField } from './milestones/TaskMilestoneField'
import { TaskDependencyField } from './TaskDependencyField'
import React from 'react'

interface TaskDetailSidebarProps {
  task: TaskDetail
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
  projects: ApiProject[]
  workspaceUrl: string
  onPatch: (patch: Record<string, unknown>) => void
  /** All workspace tags for TagPicker. */
  allTags?: ApiTag[]
  /** Called when tags change (full objects). */
  onTagsChange?: (tags: ApiTag[]) => void
  /** Called to create a new tag inline. */
  onCreateTag?: (name: string) => Promise<ApiTag | null>
}

export function TaskDetailSidebar({
  task,
  members,
  agentActors: _agentActors,
  projects,
  workspaceUrl,
  onPatch,
  allTags,
  onTagsChange,
  onCreateTag,
}: TaskDetailSidebarProps) {
  const intl = useIntl()

  return (
    <div className='w-72 shrink-0 border-l border-border overflow-y-auto px-5 py-6 bg-muted/50'>
      {/* Properties */}
      <p className='text-caption font-semibold text-muted-foreground uppercase mb-3'>
        {intl.formatMessage({ id: 'task.properties' })}
      </p>
      <div className='flex flex-col gap-0.5 mb-8'>
        {(
          [
            {
              label: intl.formatMessage({ id: 'task.status' }),
              node: (
                <StatusSelect
                  value={task.status}
                  onChange={v => onPatch({ status: v })}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            {
              label: intl.formatMessage({ id: 'task.assignee' }),
              node: (
                <AssigneeSelect
                  value={task.assigneeActorId ?? null}
                  onChange={v => onPatch({ assigneeActorId: v })}
                  members={members.filter(
                    (m): m is WorkspaceMemberInfo & { actorId: string } =>
                      m.actorId !== null
                  )}
                  agentActors={[]}
                  assignee={task.assignee}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            {
              label: intl.formatMessage({ id: 'common.project' }),
              node: (
                <ProjectSelect
                  value={task.projectId}
                  onChange={v => onPatch({ projectId: v })}
                  projects={projects}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            {
              label: intl.formatMessage({ id: 'task.priority' }),
              node: (
                <PrioritySelect
                  value={task.priority}
                  onChange={v => onPatch({ priority: v })}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            {
              label: intl.formatMessage({
                id: 'task.dependencies.field.label',
              }),
              node: (
                <TaskDependencyField
                  taskIdentifier={`${task.teamIdentifier}-${task.number}`}
                  workspaceUrl={workspaceUrl}
                />
              ),
            },
            ...(task.sprintsEnabled && task.teamId
              ? [
                  {
                    label: intl.formatMessage({
                      id: 'sprints.taskField.label',
                    }),
                    node: (
                      <TaskSprintField
                        task={{
                          id: task.id,
                          teamId: task.teamId,
                          sprintId: task.sprintId ?? null,
                          sprint: task.sprint ?? null,
                        }}
                        onChange={v => onPatch({ sprintId: v })}
                        triggerClassName={FIELD_TRIGGER_CLS}
                      />
                    ),
                  },
                ]
              : []),
            {
              label: intl.formatMessage({ id: 'task.field.milestone' }),
              node: (
                <TaskMilestoneField
                  projectId={task.projectId}
                  value={task.milestoneId ?? null}
                  milestone={task.milestone ?? null}
                  onChange={v => onPatch({ milestoneId: v })}
                  triggerClassName={FIELD_TRIGGER_CLS}
                />
              ),
            },
            ...(allTags && onTagsChange
              ? [
                  {
                    label: intl.formatMessage({ id: 'task.tags' }),
                    node: (
                      <TagPicker
                        selectedTags={task.tags ?? []}
                        allTags={allTags}
                        onChange={onTagsChange}
                        onCreateTag={onCreateTag}
                        triggerClassName='min-h-7 px-2 rounded-md hover:bg-muted'
                      />
                    ),
                  },
                ]
              : []),
          ] as { label: string; node: React.ReactNode }[]
        ).map(({ label, node }) => (
          <div key={label} className='flex items-center gap-2 -ml-2'>
            <span className='w-16 shrink-0 text-caption text-muted-foreground pl-2'>
              {label}
            </span>
            <div className='flex-1 min-w-0'>{node}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
