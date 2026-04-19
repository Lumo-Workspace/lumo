'use client'

import type {
  TaskDetail,
  ApiStatus,
  ApiPriority,
  ApiProject,
  ActorInfo,
  WorkspaceMemberInfo,
} from '../types'
import {
  StatusSelect,
  AssigneeSelect,
  ReviewerSelect,
  ProjectSelect,
  PrioritySelect,
  DueDatePicker,
  SeparatorDot,
  FIELD_TRIGGER_CLS,
} from './fields'
import { cn } from '@/lib/utils'
import type { TaskPatchData } from '../hooks/useTaskMutation'
import type { SprintStatus } from '@prisma/client'
import { TaskSprintField } from '../sprints/components/TaskSprintField'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface TaskFieldsSectionProps {
  status: ApiStatus
  priority: ApiPriority
  assigneeActorId: string | null
  reviewerActorId: string | null
  projectId: string
  dueDate: string | null
  assignee: ActorInfo | null
  ownerId: string | null
  parent: TaskDetail['parent']
  membersWithActorId: (WorkspaceMemberInfo & { actorId: string })[]
  agentActors: { actorId: string; name: string; avatarColor: string }[]
  projects: ApiProject[]
  onPatch: (data: TaskPatchData) => void
  onNavigateToParent: () => void
  teamId: string
  sprintId: string | null
  sprint?: { id: string; status: SprintStatus; name: string } | null
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TaskFieldsSection({
  status,
  priority,
  assigneeActorId,
  reviewerActorId,
  projectId,
  dueDate,
  assignee,
  ownerId,
  parent,
  membersWithActorId,
  agentActors,
  projects,
  onPatch,
  onNavigateToParent,
  teamId,
  sprintId,
  sprint,
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
      <ReviewerSelect
        value={reviewerActorId}
        onChange={v => onPatch({ reviewerActorId: v })}
        members={membersWithActorId}
        inheritedId={ownerId}
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
      {parent && (
        <>
          <SeparatorDot />
          <button
            onClick={onNavigateToParent}
            className={cn(FIELD_TRIGGER_CLS, 'gap-1')}
          >
            <span className='text-muted-foreground text-xs'>Parent</span>
            <span className='text-xs'>
              {parent.teamIdentifier}-{parent.number}
            </span>
          </button>
        </>
      )}
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
    </div>
  )
}
