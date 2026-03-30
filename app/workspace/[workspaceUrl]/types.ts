// ─── Legacy types (used by constants.ts mock data) ───────────────────────────

export type Priority = 'P0' | 'P1' | 'P2'
export type Status = 'Todo' | 'In Progress' | 'Review' | 'Done' | 'Backlog'

export interface User {
  id: string
  name: string
  avatar: string
  initials: string
}

export interface Task {
  id: string
  title: string
  status: Status
  assignee: User
  priority: Priority
  updatedAt: string
  description?: string
  subtasks?: string[]
  projectId?: string
}

export interface Notification {
  id: string
  type:
    | 'mention'
    | 'review_request'
    | 'assignment'
    | 'comment'
    | 'status_change'
    | 'merge'
  user: User
  targetId: string
  content?: string
  timestamp: string
  isUnread: boolean
  metadata?: {
    branch?: string
    additions?: number
    deletions?: number
  }
}

// ─── API types ────────────────────────────────────────────────────────────────

export interface ActorInfo {
  id: string
  type: 'HUMAN' | 'AGENT'
  member?: { id: string; clerkId: string } | null
  agent?: { id: string; name: string; avatarColor: string } | null
}

export type ApiPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type ApiStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE'

export type Page =
  | 'my-tasks'
  | 'projects'
  | 'project-detail'
  | 'inbox'
  | 'task-detail'

export interface WorkspaceMemberInfo {
  id: string
  clerkId: string
  role: string
  name: string
  email: string | null
  imageUrl: string | null
  joinedAt: string
  actorId: string | null
}

/** Task assigned to the current user — always has `project` populated */
export type MyTask = Omit<ApiTask, 'project'> & {
  project: { id: string; name: string }
}

export interface ApiRepository {
  id: string
  projectId: string
  fullName: string // "owner/repo"
  name: string
  isDefault: boolean
  createdAt: string
}

export interface ApiProject {
  id: string
  name: string
  description: string | null
  isIdea: boolean
  defaultReviewerId: string | null
  repositories?: ApiRepository[]
  updatedAt: string
  createdAt: string
  _count: { tasks: number }
  inProgressCount: number
  kanbanViewId?: string
}

export type AgentStatusValue =
  | 'IDLE'
  | 'RUNNING'
  | 'PAUSED'
  | 'DONE'
  | 'FAILED'
  | 'ERROR'
  | 'CANCELLED'
  | 'SPEC_REVIEW'

export interface ApiTask {
  id: string
  title: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  parentTaskId: string | null
  assigneeActorId: string | null
  reviewerActorId: string | null
  assignee?: ActorInfo | null
  repositoryId: string | null
  agentStatus?: AgentStatusValue | null
  updatedAt: string
  viewOrder: number | null
  number: number
  teamIdentifier: string
  /** Populated when task is loaded via /api/tasks/me */
  project?: { id: string; name: string }
}

export interface ApiPullRequest {
  id: string
  number: number
  title: string
  url: string
  state: string // "open" | "closed" | "merged"
  authorLogin: string
  headBranch: string
  ciStatus: string | null // "pending" | "success" | "failure" | null
  mergedAt: string | null
  createdAt: string
}

export interface ApiTaskBranch {
  id: string
  repo: string
  branchName: string
  lastCommitSha: string | null
  lastCommitMessage: string | null
  lastCommitAuthor: string | null
  lastPushedAt: string | null
  createdAt: string
}

export interface ApiComment {
  id: string
  taskId: string
  authorActorId: string | null // Actor.id — null for system comments
  body: string // HTML
  parentId: string | null
  quotedCommentId: string | null
  type: 'USER' | 'AGENT'
  createdAt: string
  updatedAt: string
  /** Only present on top-level comments (parentId === null). */
  replies?: ApiComment[]
}

export interface ApiNotification {
  id: string
  type:
    | 'TASK_IN_REVIEW'
    | 'TASK_MENTIONED'
    | 'TASK_SENT_BACK'
    | 'TASK_ASSIGNED'
    | 'TASK_SPEC_READY'
    | 'AGENT_CLARIFY'
    | 'AGENT_FAILED'
    | 'AGENT_DONE'
  read: boolean
  createdAt: string
  taskId: string | null
  commentId: string | null
  clarifyId: string | null
  triggerActorId: string | null
  actor: { name: string; imageUrl: string | null } | null
  task: {
    id: string
    title: string
    number: number
    teamIdentifier: string
  } | null
  commentPreview: string | null
}

export interface ApiAgentClarify {
  id: string
  question: string
  context: string | null
  reply: string | null
  repliedAt: string | null
  createdAt: string
}

export interface TaskDetail {
  id: string
  title: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  project: {
    id: string
    name: string
    defaultReviewerId?: string | null
    repositories?: ApiRepository[]
  }
  parentTaskId: string | null
  assigneeActorId: string | null
  reviewerActorId: string | null
  repositoryId: string | null
  assignee: ActorInfo | null
  reviewer: ActorInfo | null
  description: string | null
  updatedAt: string
  number: number
  teamIdentifier: string
  children?: { id: string; title: string; number: number }[]
  pullRequests?: ApiPullRequest[]
  branches?: ApiTaskBranch[]
  agentStatus?: string | null
  agentError?: string | null
  sandboxId?: string | null
  clarifies?: ApiAgentClarify[]
  spec?: string | null
}
