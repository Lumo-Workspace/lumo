'use client'

import { useIntl } from 'react-intl'
import { GitBranch } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TagPicker } from './document/TagPicker'
import { TaskSprintField } from '../sprints/components/TaskSprintField'
import { TaskMilestoneField } from './milestones/TaskMilestoneField'
import { ForecastPanel } from './ForecastPanel'
import React from 'react'

interface TaskDetailSidebarProps {
  task: TaskDetail
  members: WorkspaceMemberInfo[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
  projects: ApiProject[]
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
  onPatch,
  allTags,
  onTagsChange,
  onCreateTag,
}: TaskDetailSidebarProps) {
  const intl = useIntl()
  const projectRepositories = task.project?.repositories

  return (
    <div className='w-72 shrink-0 border-l border-zinc-100 dark:border-zinc-800 overflow-y-auto px-5 py-6 bg-zinc-50/50 dark:bg-zinc-900/30'>
      {/* Properties */}
      <p className='text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider mb-3'>
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
            ...((projectRepositories?.length ?? 0) > 0
              ? [
                  {
                    label: intl.formatMessage({ id: 'task.repository' }),
                    node: (
                      <Select
                        value={task.repositoryId ?? '__none__'}
                        onValueChange={v =>
                          onPatch({
                            repositoryId: v === '__none__' ? null : v,
                          })
                        }
                      >
                        <SelectTrigger className={FIELD_TRIGGER_CLS}>
                          <GitBranch size={12} className='mr-1 shrink-0' />
                          <SelectValue
                            placeholder={intl.formatMessage({
                              id: 'task.repository',
                            })}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value='__none__'>
                            {intl.formatMessage({ id: 'task.noRepository' })}
                          </SelectItem>
                          {projectRepositories!.map(repo => (
                            <SelectItem key={repo.id} value={repo.id}>
                              {repo.isDefault
                                ? intl.formatMessage(
                                    { id: 'task.repoDefault' },
                                    { name: repo.name }
                                  )
                                : repo.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ),
                  },
                ]
              : []),
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
                        triggerClassName='min-h-7 px-2 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800'
                      />
                    ),
                  },
                ]
              : []),
          ] as { label: string; node: React.ReactNode }[]
        ).map(({ label, node }) => (
          <div key={label} className='flex items-center gap-2 -ml-2'>
            <span className='w-16 shrink-0 text-[11px] text-zinc-400 dark:text-zinc-500 pl-2'>
              {label}
            </span>
            <div className='flex-1 min-w-0'>{node}</div>
          </div>
        ))}
      </div>
      <ForecastPanel taskId={task.id} />
    </div>
  )
}
