'use client'

import type {
  ApiStatus,
  ApiPriority,
  ApiProject,
  ActorInfo,
  WorkspaceMemberInfo,
} from '../types'
import {
  StatusSelect,
  AssigneeSelect,
  ProjectSelect,
  PrioritySelect,
  DueDatePicker,
  SeparatorDot,
  FIELD_TRIGGER_CLS,
} from './fields'
import type { TaskPatchData } from '../hooks/useTaskMutation'
import type { SprintStatus } from '@prisma/client'
import { TaskSprintField } from '../sprints/components/TaskSprintField'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TaskFieldsSectionProps {
  status: ApiStatus
  priority: ApiPriority
  assigneeActorId: string | null
  projectId: string
  dueDate: string | null
  assignee: ActorInfo | null
  membersWithActorId: (WorkspaceMemberInfo & { actorId: string })[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
  projects: ApiProject[]
  onPatch: (data: TaskPatchData) => void
  teamId: string
  sprintId: string | null
  sprint?: { id: string; status: SprintStatus; name: string } | null
  /** Whether the owning team has sprints enabled — gates the sprint selector. */
  sprintsEnabled?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskFieldsSection({
  status,
  priority,
  assigneeActorId,
  projectId,
  dueDate,
  assignee,
  membersWithActorId,
  agentActors,
  projects,
  onPatch,
  teamId,
  sprintId,
  sprint,
  sprintsEnabled,
}: TaskFieldsSectionProps) {
  return (
    <div className='flex items-center gap-1 flex-wrap -ml-2 mb-1'>
      <StatusSelect
        value={status}
        onChange={v => onPatch({ status: v })}
        triggerClassName={FIELD_TRIGGER_CLS}
      />
      <SeparatorDot />
      <AssigneeSelect
        value={assigneeActorId}
        onChange={v => onPatch({ assigneeActorId: v })}
        members={membersWithActorId}
        agentActors={agentActors}
        assignee={assignee}
        triggerClassName={FIELD_TRIGGER_CLS}
      />
      <SeparatorDot />
      <ProjectSelect
        value={projectId}
        onChange={v => onPatch({ projectId: v })}
        projects={projects}
        triggerClassName={FIELD_TRIGGER_CLS}
      />
      <SeparatorDot />
      <PrioritySelect
        value={priority}
        onChange={v => onPatch({ priority: v })}
        triggerClassName={FIELD_TRIGGER_CLS}
      />
      <SeparatorDot />
      <DueDatePicker
        value={dueDate}
        onChange={v => onPatch({ dueDate: v })}
        triggerClassName={FIELD_TRIGGER_CLS}
      />
      {sprintsEnabled && teamId && (
        <>
          <SeparatorDot />
          <TaskSprintField
            task={{
              id: '',
              teamId,
              sprintId: sprintId ?? null,
              sprint: sprint ?? null,
            }}
            onChange={v => onPatch({ sprintId: v })}
            triggerClassName={FIELD_TRIGGER_CLS}
          />
        </>
      )}
    </div>
  )
}
