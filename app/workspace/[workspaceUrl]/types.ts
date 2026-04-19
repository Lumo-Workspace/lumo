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

// ─── Task pre-fill fields (used for draft restoration and NewTaskModal) ──────

export interface TaskPreFillFields {
  title: string
  description: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  assigneeId: string
  dueDate: string | null
}

export type Page =
  | 'my-tasks'
  | 'projects'
  | 'project-detail'
  | 'inbox'
  | 'task-detail'
  | 'documents'
  | 'document-editor'
  | 'drafts'
  | 'dashboard'
  | 'sprints'

export interface ApiDraft {
  id: string
  type: 'TASK' | 'PROJECT'
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

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

/** Task assigned to the current user — always has `project` populated.
 * `ownerActorId` is the project owner's Actor.id, suitable for the
 * shared MemberAvatar resolver. */
export type MyTask = Omit<ApiTask, 'project'> & {
  project: { id: string; name: string; ownerActorId: string | null }
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
  ownerId: string | null
  repositories?: ApiRepository[]
  updatedAt: string
  createdAt: string
  _count: { tasks: number }
  todoCount: number
  inProgressCount: number
  inReviewCount: number
  doneCount: number
  owner: { id: string; name: string } | null
  kanbanViewId?: string
  riskOverdueRatio?: number | null
  riskStalledDays?: number | null
  riskStalledMinCount?: number | null
  riskAgentFailRatio?: number | null
  riskStalePrDays?: number | null
  riskThroughputDrop?: number | null
}

export type AgentStatusValue =
  | 'SUBMITTED'
  | 'WORKING'
  | 'INPUT_REQUIRED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'

export interface ApiTask {
  id: string
  title: string
  status: ApiStatus
  priority: ApiPriority
  projectId: string
  teamId?: string
  parentTaskId: string | null
  assigneeActorId: string | null
  reviewerActorId: string | null
  assignee?: ActorInfo | null
  repositoryId: string | null
  agentStatus?: AgentStatusValue | null
  createdAt: string
  updatedAt: string
  dueDate?: string | null
  viewOrder: number | null
  number: number
  teamIdentifier: string
  /** Populated when task is loaded via /api/tasks/me */
  project?: { id: string; name: string }
  parent?: {
    id: string
    number: number
    teamIdentifier: string
    title: string
  } | null
  _count?: { children: number }
  childrenDoneCount?: number
  sprintId?: string | null
  sprint?: {
    id: string
    status: import('@prisma/client').SprintStatus
    name: string
  } | null
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
    | 'AGENT_AUTHORIZE'
    | 'AGENT_VERIFY'
    | 'AGENT_FAILED'
    | 'AGENT_DONE'
  read: boolean
  requiresAction: boolean
  actionTakenAt: string | null
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
  /** Populated for AGENT_CLARIFY notifications */
  clarifyQuestion: string | null
  clarifyContext: string | null
}

export interface ApiAgentRun {
  id: string
  runNumber: number
  status: AgentStatusValue
  trigger: string | null
  errorCode: string | null
  errorMessage: string | null
  summary: string | null
  steps:
    | { key: string; text: string; elapsedMs: number; status: string }[]
    | null
  changedFiles:
    | { path: string; status: 'added' | 'modified' | 'deleted' }[]
    | null
  durationMs: number | null
  prNumber: number | null
  prUrl: string | null
  branchName: string | null
  startedAt: string
  finishedAt: string | null
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
    workspaceId?: string
    ownerId?: string | null
    repositories?: ApiRepository[]
  }
  parentTaskId: string | null
  parent?: {
    id: string
    number: number
    teamIdentifier: string
    title: string
  } | null
  assigneeActorId: string | null
  reviewerActorId: string | null
  repositoryId: string | null
  assignee: ActorInfo | null
  reviewer: ActorInfo | null
  description: string | null
  updatedAt: string
  dueDate?: string | null
  number: number
  teamIdentifier: string
  children?: { id: string; title: string; number: number; status: string }[]
  pullRequests?: ApiPullRequest[]
  branches?: ApiTaskBranch[]
  agentStatus?: string | null
  agentError?: string | null
  inputReason?: string | null
  clarifies?: ApiAgentClarify[]
  agentRuns?: ApiAgentRun[]
  spec?: string | null
  tags?: ApiTag[]
  sprintId?: string | null
  sprint?: {
    id: string
    status: import('@prisma/client').SprintStatus
    name: string
  } | null
  teamId?: string
}

// ── Tags ─────────────────────────────────────────────────────────────────

export interface ApiTag {
  id: string
  name: string
  color: string | null
  workspaceId: string
  createdAt: string
}

export interface ApiTagWithCounts extends ApiTag {
  taskCount: number
  documentCount: number
}

// ── Documents ─────────────────────────────────────────────────────────────

export type DocVisibility = 'PRIVATE' | 'SHARED' | 'WORKSPACE'
export type DocShareRole = 'VIEWER' | 'EDITOR' | 'MANAGER'

export interface ApiDocument {
  id: string
  title: string
  emoji: string | null
  parentId: string | null
  projectId: string | null
  project?: { id: string; name: string } | null
  workspaceId: string
  createdById: string
  createdBy: { id: string; name: string; imageUrl: string | null }
  visibility: DocVisibility
  sortOrder: number
  createdAt: string
  updatedAt: string
  _count?: { children: number }
  tags?: string[]
  docTags?: ApiTag[]
  editors?: Array<{
    member: { id: string; name: string; imageUrl: string | null }
    lastEditedAt: string
  }>
}

export interface ApiDocumentAncestor {
  id: string
  title: string
  emoji: string | null
  children?: {
    id: string
    title: string
    emoji: string | null
    _count: { children: number }
  }[]
}

export interface TreeNode {
  id: string
  title: string
  emoji: string | null
  parentId: string | null
  sortOrder: number
  childCount: number
  children?: TreeNode[]
  isLoading?: boolean
}

export interface ApiDocumentDetail extends ApiDocument {
  content: string | null
  publicToken?: string | null | undefined
  children: ApiDocument[]
  shares: ApiDocumentShare[]
  ancestors?: ApiDocumentAncestor[]
}

export interface ApiDocumentShare {
  id: string
  memberId: string
  member: { id: string; name: string; imageUrl: string | null }
  role: DocShareRole
  createdAt: string
}

export interface ApiPullRequestSearchResult {
  id: string
  repo: string
  number: number
  title: string
  url: string
  state: string
  ciStatus: string | null
  authorLogin: string
  headBranch: string
  createdAt: string
  task: {
    id: string
    number: number
    title: string
    team: { identifier: string }
  } | null
}

// ── Timeline ─────────────────────────────────────────────────────────────────

export interface TimelineActivityEntry {
  id: string
  kind: 'activity'
  type: string
  payload: Record<string, unknown> | null
  actorId: string | null
  actor?: {
    id: string
    type: string
    member?: { id: string; clerkId: string } | null
    agent?: { id: string; name: string; avatarColor: string } | null
  } | null
  createdAt: string
}

export interface TimelineCommentEntry {
  id: string
  kind: 'comment'
  body: string
  authorActorId: string | null
  parentId: string | null
  quotedCommentId: string | null
  type: string
  createdAt: string
  updatedAt: string
  replies?: TimelineCommentEntry[]
}

export type TimelineEntry = TimelineActivityEntry | TimelineCommentEntry

export interface TimelineResponse {
  items: TimelineEntry[]
  hasMore: boolean
  nextCursor: string | null
}
