// ── Task activity domain events ────────────────────────────────────────────

export type TaskCreatedEvent = {
  type: 'task:created'
  taskId: string
  projectId: string
  actorId: string
}

export type TaskFieldChangedEvent = {
  type:
    | 'task:status_changed_activity'
    | 'task:priority_changed'
    | 'task:title_changed'
    | 'task:description_changed'
    | 'task:due_date_changed'
  taskId: string
  projectId: string
  actorId: string
  from: string | null
  to: string | null
}

export type TaskActorChangedEvent = {
  type: 'task:assignee_changed'
  taskId: string
  projectId: string
  actorId: string
  fromActorId: string | null
  toActorId: string | null
  toName: string | null
}

export type TaskTagsChangedEvent = {
  type: 'task:tags_changed'
  taskId: string
  projectId: string
  actorId: string
  added: string[]
  removed: string[]
}

export type TaskCommentEvent = {
  type: 'task:comment_added' | 'task:comment_deleted'
  taskId: string
  projectId: string
  actorId: string
  commentId: string
}

export type TaskSpecEvent = {
  type: 'task:spec_generated'
  taskId: string
  projectId: string
  actorId: string
}

export type TaskPrEvent = {
  type:
    | 'task:pr_linked'
    | 'task:pr_unlinked'
    | 'task:pr_created'
    | 'task:pr_merged'
  taskId: string
  projectId: string
  actorId: string | null
  prId?: string
  prNumber: number
  prUrl?: string
  prTitle?: string
}

export type TaskAgentRunEvent = {
  type:
    | 'task:agent_run_started'
    | 'task:agent_run_completed'
    | 'task:agent_run_failed'
    | 'task:agent_input_required'
  taskId: string
  projectId: string
  actorId: string | null
  runId: string
  runNumber: number
  errorCode?: string
  reason?: string
}

export type TaskActivityEvent =
  | TaskCreatedEvent
  | TaskFieldChangedEvent
  | TaskActorChangedEvent
  | TaskTagsChangedEvent
  | TaskCommentEvent
  | TaskSpecEvent
  | TaskPrEvent
  | TaskAgentRunEvent
