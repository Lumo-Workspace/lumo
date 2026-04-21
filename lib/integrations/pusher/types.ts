// ── Agent events (existing) ─────────────────────────────────────────────────

export type AgentEvent =
  | {
      type: 'agent:started'
      runNumber: number
      steps?: { key: string; text: string; elapsedMs: number; status: string }[]
    }
  | { type: 'agent:thinking'; message: string }
  | { type: 'agent:tool'; tool: string; input: string }
  | { type: 'agent:progress'; message: string; key?: string }
  | { type: 'agent:clarify'; question: string; context: string | null }
  | { type: 'agent:spec_draft'; spec: string }
  | {
      type: 'agent:done'
      prUrl: string
      prNumber: number
      summary?: string
      changedFiles?: {
        path: string
        status: 'added' | 'modified' | 'deleted' | 'renamed'
      }[]
      durationMs?: number
    }
  | { type: 'agent:failed'; error: string }

// ── Task events (comments, field changes) ───────────────────────────────────

export type TaskEvent =
  | { type: 'comment:created'; commentId: string }
  | { type: 'comment:updated'; commentId: string }
  | { type: 'comment:deleted'; commentId: string }
  | { type: 'task:updated'; fields: string[] }

// ── Project events (board-level updates) ────────────────────────────────

export type ProjectEvent = {
  type: 'task:updated'
  taskId: string
  fields: string[]
  /** Partial task data for lightweight board updates */
  patch?: Record<string, unknown>
}

// ── User events (notifications) ─────────────────────────────────────────────

export type UserEvent = { type: 'notification:new' }

// ── Activity events (timeline updates) ──────────────────────────────────────

export type ActivityPusherEvent = {
  type: 'activity:created'
  entry: Record<string, unknown>
}

// ── Workspace events (cross-member sidebar, etc.) ──────────────────────────

export type WorkspaceEvent = {
  type: 'projects-reordered'
  orderedIds: string[]
}
