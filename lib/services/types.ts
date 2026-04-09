// lib/services/types.ts
// Shared type definitions for the service layer.
// These types define contracts between API routes and service methods.

// ── Task service types ──────────────────────────────────────────────────────

export interface CreateCommentInput {
  taskId: string
  authorActorId: string
  body: string
  parentId: string | null
  quotedCommentId: string | null
}

export interface CreateProjectInput {
  name: string
  description?: string | undefined
  isIdea?: boolean | undefined
}

// ── Notification service types ──────────────────────────────────────────────

export type NotificationAction =
  | 'reply'
  | 'confirm'
  | 'send_back'
  | 'approve'
  | 'deny'
