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
} from './fields'
import { TagPicker } from './document/TagPicker'
import { TaskSprintField } from '../sprints/components/TaskSprintField'
import { TaskMilestoneField } from './milestones/TaskMilestoneField'
import { TaskDependencyField } from './TaskDependencyField'
import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'

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
  const t = (id: string) => intl.formatMessage({ id })

  return (
    <div className='flex flex-col gap-4'>
      <PropertySection title={t('task.properties')}>
        <PropertyRow label={t('task.status')}>
          <StatusSelect
            variant='ghost'
            value={task.status}
            onChange={v => onPatch({ status: v })}
          />
        </PropertyRow>
        <PropertyRow label={t('task.priority')}>
          <PrioritySelect
            variant='ghost'
            value={task.priority}
            onChange={v => onPatch({ priority: v })}
          />
        </PropertyRow>
        <PropertyRow label={t('task.assignee')}>
          <AssigneeSelect
            variant='ghost'
            value={task.assigneeActorId ?? null}
            onChange={v => onPatch({ assigneeActorId: v })}
            members={members.filter(
              (m): m is WorkspaceMemberInfo & { actorId: string } =>
                m.actorId !== null
            )}
            agentActors={[]}
            assignee={task.assignee}
          />
        </PropertyRow>
      </PropertySection>

      <Separator />

      <PropertySection title={t('task.section.planning')}>
        <PropertyRow label={t('common.project')}>
          <ProjectSelect
            variant='ghost'
            value={task.projectId}
            onChange={v => onPatch({ projectId: v })}
            projects={projects}
          />
        </PropertyRow>
        {task.sprintsEnabled && task.teamId ? (
          <PropertyRow label={t('sprints.taskField.label')}>
            <TaskSprintField
              variant='ghost'
              task={{
                id: task.id,
                teamId: task.teamId,
                sprintId: task.sprintId ?? null,
                sprint: task.sprint ?? null,
              }}
              onChange={v => onPatch({ sprintId: v })}
            />
          </PropertyRow>
        ) : null}
        <PropertyRow label={t('task.field.milestone')}>
          <TaskMilestoneField
            variant='ghost'
            projectId={task.projectId}
            value={task.milestoneId ?? null}
            milestone={task.milestone ?? null}
            onChange={v => onPatch({ milestoneId: v })}
          />
        </PropertyRow>
      </PropertySection>

      <Separator />

      <PropertySection title={t('task.section.relations')}>
        <PropertyRow label={t('task.dependencies.field.label')}>
          <TaskDependencyField
            taskIdentifier={`${task.teamIdentifier}-${task.number}`}
            workspaceUrl={workspaceUrl}
          />
        </PropertyRow>
        {allTags && onTagsChange ? (
          <PropertyRow label={t('task.tags')}>
            <TagPicker
              selectedTags={task.tags ?? []}
              allTags={allTags}
              onChange={onTagsChange}
              onCreateTag={onCreateTag}
              triggerClassName='min-h-control-sm rounded-md px-2 py-1 transition-colors hover:bg-accent'
            />
          </PropertyRow>
        ) : null}
      </PropertySection>
    </div>
  )
}

/** A titled group of property rows (sentence-case muted caption heading). */
function PropertySection({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className='flex flex-col gap-1'>
      <h3 className='px-2 pb-1 text-caption text-muted-foreground'>{title}</h3>
      {children}
    </section>
  )
}

/**
 * One label/value row. Every row shares the control-sm height and the same
 * label column, so ghost values line up on one left edge.
 */
function PropertyRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className='grid min-h-control-sm grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-1'>
      <span className='truncate px-2 text-body text-muted-foreground'>
        {label}
      </span>
      <div className='min-w-0'>{children}</div>
    </div>
  )
}
