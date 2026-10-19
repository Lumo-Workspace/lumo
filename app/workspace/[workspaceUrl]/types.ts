import type { TaskArtifactAgent } from '@prisma/client'

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
export type ApiStatus =
  | 'BACKLOG'
  | 'TODO'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'DONE'

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
  | 'sprints'
  | 'sprint-detail'
  | 'milestone-detail'

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
  assigneeActorId: string | null
  assignee?: ActorInfo | null
  agentStatus?: AgentStatusValue | null
  createdAt: string
  updatedAt: string
  dueDate?: string | null
  viewOrder: number | null
  number: number
  teamIdentifier: string
  /** Populated when task is loaded via /api/tasks/me */
  project?: { id: string; name: string }
  /** Populated on list payloads that lift the taskTags join (board filtering). */
  tags?: ApiTag[]
  sprintId?: string | null
  sprint?: {
    id: string
    status: import('@prisma/client').SprintStatus
    name: string
  } | null
  milestoneId?: string | null
  /** Populated on list payloads so board filtering can label the milestone.
   * `archivedAt` is carried because the Milestone filter only offers active,
   * non-archived milestones. */
  milestone?: {
    id: string
    /** LUM-714: derived completion stamp; non-null = the milestone is done. */
    completedAt?: string | null
    name: string
    archivedAt?: string | null
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
  /** LUM-1232 G2: member / agent / `@github-login` name from the API; null
   * when unknown, absent on optimistic (temp-id) comments. */
  authorName?: string | null
  /** LUM-783: write-time injection scan of the body; null = clean. */
  contentSignals?: unknown
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
    | 'TASK_DONE'
    | 'AGENT_CLARIFY'
    | 'AGENT_AUTHORIZE'
    | 'AGENT_VERIFY'
    | 'AGENT_FAILED'
    | 'AGENT_DONE'
    | 'SPRINT_STARTED'
    | 'SPRINT_CLOSED'
    | 'DOCUMENT_COMMENT_MENTIONED'
    | 'PROJECT_MENTIONED'
    | 'MILESTONE_MENTIONED'
    | 'DOCUMENT_MENTIONED'
  read: boolean
  requiresAction: boolean
  actionTakenAt: string | null
  createdAt: string
  taskId: string | null
  commentId: string | null
  clarifyId: string | null
  sprintId: string | null
  triggerActorId: string | null
  actor: { name: string; imageUrl: string | null } | null
  task: {
    id: string
    title: string
    number: number
    teamIdentifier: string
  } | null
  sprint: {
    id: string
    name: string
    number: number
    teamId: string
  } | null
  projectId: string | null
  milestoneId: string | null
  documentId: string | null
  project: { id: string; name: string; url: string } | null
  milestone: { id: string; name: string; url: string } | null
  document: { id: string; title: string; url: string } | null
  commentPreview: string | null
  /** Populated for AGENT_CLARIFY notifications */
  clarifyQuestion: string | null
  clarifyContext: string | null
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
  }
  assigneeActorId: string | null
  assignee: ActorInfo | null
  description: string | null
  updatedAt: string
  dueDate?: string | null
  number: number
  teamIdentifier: string
  pullRequests?: ApiPullRequest[]
  branches?: ApiTaskBranch[]
  agentStatus?: string | null
  agentError?: string | null
  inputReason?: string | null
  spec?: string | null
  tags?: ApiTag[]
  sprintId?: string | null
  sprint?: {
    id: string
    status: import('@prisma/client').SprintStatus
    name: string
  } | null
  milestoneId?: string | null
  milestone?: {
    id: string
    name: string
    /** LUM-714: derived completion stamp; non-null = the milestone is done. */
    completedAt?: string | null
  } | null
  teamId?: string
  /** Whether the owning team has sprints enabled. Sourced from `team.sprintsEnabled`
   * and flattened in `taskService.getTaskDetail`. UI uses it to gate sprint controls. */
  sprintsEnabled?: boolean
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
  number: number
  slug: string
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
  preview?: string | null
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
  slug: string
  title: string
  emoji: string | null
  children?: {
    id: string
    slug: string
    title: string
    emoji: string | null
    _count: { children: number }
  }[]
}

export interface TreeNode {
  id: string
  /**
   * URL-facing slug (`<slugify(title)>-<number>`). May be `null` for an
   * optimistic node still waiting on the server round-trip; otherwise stable.
   */
  slug: string | null
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
  /** Member / agent / `@github-login` name from the API (LUM-1238). */
  authorName?: string | null
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

// ── Agent Run timeline (Claude Code hook events grouped by Session) ──────────

// Client copy of lib/services/model-cost.ts `ModelCost`. Kept here because
// lib/services/* is server-only by convention (may later acquire Prisma/Node
// imports), so it can't be imported into the client bundle. Keep fields in sync.
export interface ModelCost {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
  /**
   * Mid-turn share of this row not yet settled by a STOP anchor (LUM-345).
   * The flat fields above already include it; the UI renders this share as a
   * provisional bar segment + annotation. Absent on fully settled rows.
   */
  inFlight?: {
    input: number
    output: number
    cacheRead: number
    cacheCreation: number
    total: number
  }
}

// Mirror of the Prisma `HookEventType` enum. The backend
// (agent-run-timeline.service) forwards the raw enum value verbatim, so this
// union MUST stay in sync with prisma/schema.prisma — any value missing here
// falls through the categorizer and crashes the timeline row on `style.dot`.
export type AgentRunHookEventType =
  | 'PRE_TOOL_USE'
  | 'POST_TOOL_USE'
  | 'POST_TOOL_USE_FAILURE'
  | 'STOP'
  | 'STOP_FAILURE'
  | 'USER_PROMPT_SUBMIT'
  | 'PERMISSION_REQUEST'
  | 'PERMISSION_DENIED'
  | 'SESSION_START'
  | 'SESSION_END'
  | 'SUBAGENT_START'
  | 'SUBAGENT_STOP'
  | 'WORKTREE_CREATE'
  | 'WORKTREE_REMOVE'
  | 'FILE_CHANGED'
  | 'CONFIG_CHANGE'
  | 'TASK_CREATED'
  | 'TASK_COMPLETED'
  | 'POST_TOOL_BATCH'
  | 'USER_PROMPT_EXPANSION'
  | 'NOTIFICATION'
  | 'ELICITATION'
  | 'ELICITATION_RESULT'
  | 'CWD_CHANGED'
  | 'INSTRUCTIONS_LOADED'
  | 'PRE_COMPACT'
  | 'POST_COMPACT'
  | 'INTERRUPT'

export interface AgentRunHookEventItem {
  id: string
  kind: 'hook'
  type: AgentRunHookEventType
  toolName: string | null
  payload: unknown
  /** Server-side LLM-generated summary for STOP / STOP_FAILURE events.
   *  Null for non-stop events and for stop events that haven't been
   *  processed yet (or failed extraction). */
  turnSummary: string | null
  /** Per-turn per-model cost (STOP rows only); null elsewhere. */
  turnCost: { byModel: ModelCost[] } | null
  createdAt: string
}

export type AgentRunMemoryCategory =
  | 'TRAP'
  | 'DECISION'
  | 'CONVENTION'
  | 'PROCEDURAL'

export interface AgentRunMemoryItem {
  id: string
  kind: 'memory'
  category: AgentRunMemoryCategory
  agent: TaskArtifactAgent
  content: unknown
  createdAt: string
}

export type AgentRunItem = AgentRunHookEventItem | AgentRunMemoryItem

// ── Run attribution (LUM-932 P4) ─────────────────────────────────────────────
// Client mirror of the types in lib/attribution/run-attribution.ts (a pure,
// client-safe module); keep structurally identical.
export type AttributionSourceName =
  | 'SESSION_ATTACH'
  | 'SUBAGENT_ATTACH'
  | 'INHERITED'
  | 'INFERRED'
export type AttributionConfidenceName = 'EXPLICIT' | 'HIGH' | 'MEDIUM'
export type SignalKindName =
  | 'BRANCH'
  | 'LUMO_CMD'
  | 'COMMIT'
  | 'PR_CREATE'
  | 'PROMPT'
  | 'GIT_HINT'
  | 'AGENT_PROMPT'

export interface EvidenceView {
  kind: SignalKindName
  identifier: string
  at: string
}
export interface RunSegmentView {
  source: AttributionSourceName
  confidence: AttributionConfidenceName
  fromTurn: number
  toTurn: number
  fromAt: string
  toAt: string | null
  evidence: EvidenceView[]
}
export interface RunSubagentView {
  sessionId: string
  agentType: string | null
  source: AttributionSourceName
  confidence: AttributionConfidenceName
  evidence: EvidenceView[]
  /** An INFERRED subagent with no signal of its own rode its parent's
   *  attribution; `evidence` then holds the parent's covering signals. */
  followsParent: boolean
}
/** EXPLICIT = the run's session is bound to this task; INFERRED = the
 *  session is unbound and auto-detected onto it; HOST = the session is
 *  unbound and only hosts subagents that attached this task themselves. */
export type RunAttributionMode = 'EXPLICIT' | 'INFERRED' | 'HOST'
export interface RunAttribution {
  mode: RunAttributionMode
  segments: RunSegmentView[]
  subagents: RunSubagentView[]
  /** Some of this run's work on the task was auto-detected (not bound). */
  approximate: boolean
}

export interface AgentRunSession {
  sessionId: string | null
  agent: TaskArtifactAgent
  runNumber: number
  startedAt: string
  lastActivityAt: string
  durationMs: number
  toolCallCount: number
  eventCount: number
  memoryCount: number
  /** LLM-generated one-paragraph summary of the whole run; null until the
   *  generation service has synthesized one (LUM-481). */
  runSummary: string | null
  /** Per-run cost split by model; null when nothing captured. */
  cost: { byModel: ModelCost[]; loopCount: number | null } | null
  /** Owning member (Clerk-resolved name + avatar) shown in the run header;
   *  null for orphan / unlinked runs with no member (LUM-308). */
  member: { workspaceMemberId: string; name: string; imageUrl: string } | null
  /** Why this run's work is on the task; null for the unlinked run. */
  attribution: RunAttribution | null
  /** ISO time the session was corrected by `lumo usage resync`; null if never. */
  usageResyncedAt: string | null
  items: AgentRunItem[]
}

/** Per-person token spend on a task (LUM-307). One entry per workspace member
 *  with captured cost; resolved Clerk name + avatar for display. */
export interface AgentRunMemberStat {
  workspaceMemberId: string
  clerkId: string | null
  name: string
  imageUrl: string
  runCount: number
  loopCount: number
  byModel: ModelCost[]
}

export interface AgentRunTimelineResponse {
  runs: AgentRunSession[]
  totals: {
    runCount: number
    loopCount: number
    byModel: ModelCost[]
  }
  /** Token spend grouped by owning member, sorted by spend desc; empty when
   *  no run captured usage. */
  perMember: AgentRunMemberStat[]
}

// ── Lineage (read-only causal-trail panel, LUM-297) ──────────────────────────
// Standalone client copy of lib/services/lineage.service.ts `LineageDto`. The
// service is server-only (Prisma graph), so it cannot be imported into the
// client bundle — keep this shape in sync with that DTO if the API changes.
export type LineageOutcome = 'MERGED' | 'REJECTED' | 'REWORKED' | 'UNKNOWN'

export type LineageDisclosure = 'FULL' | 'INDEX'

export interface LineageTokens {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  total: number
}

export interface LineageFragment {
  fragmentType: string
  fragmentId: string
  sourceLabel: string
  outcome: LineageOutcome
  /** LUM-522 manual usage judgment (true=used, false=unused, null=no vote). */
  used: boolean | null
  /** LUM-500/521 how the fragment was injected at session-start. */
  disclosure: LineageDisclosure
  /** LUM-521 whether the agent pulled this edge's body on demand. */
  pulled: boolean
}

export interface LineageGroup {
  kind: 'session' | 'orphan'
  sessionId: string | null
  label: string
  includedAt: string
  cost: {
    input: number
    output: number
    cacheRead: number
    cacheCreation: number
    total: number
    loopCount: number
  } | null
  fragments: LineageFragment[]
}

export interface LineageResponse {
  task: { identifier: string; title: string; status: string }
  totals: {
    runCount: number
    fragmentCount: number
    edgeCount: number
    tokens: LineageTokens
    loopCount: number
    outcomes: Record<LineageOutcome, number>
    funnel: {
      impressions: number
      index: number
      pulled: number
      used: number
      tokensSaved: number | null
    }
    topOperations: {
      tool: string
      output: number
      input: number
      cacheCreation: number
      cacheRead: number
      total: number
      /** LUM-840: per-command rows under a `Bash · <purpose>` row, most expensive first. */
      commands?: {
        command: string
        output: number
        input: number
        cacheCreation: number
        cacheRead: number
        total: number
      }[]
    }[]
  }
  groups: LineageGroup[]
}

// ── Task status read model (GET /api/tasks/[id]/status, schema v2) ─────────
// Client mirror of lib/services/task-status.service.ts `TaskStatusReport`
// (front end must not import lib/services). Only the fields the Record tab
// renders are mirrored.

/** Rework traces (LUM-561) — PR cycles and reopens. Both arrays empty is a
 *  legitimate (honest) state. Client mirror of the server `StruggleTrail`. */
export interface StruggleTrailView {
  pullRequests: Array<{ number: number; url: string }>
  reopens: Array<{ from: string; to: string; at: string }>
}

/** Honest cost read-out (LUM-560). Client mirror of the server `TaskCost`.
 *  `tokenCost` null = NOT measured (no session usage recorded) — deliberately
 *  distinct from a measured 0 (花了0 vs 没测到). */
export interface TaskCostView {
  tokenCost: number | null
  activeTimeSec: number
}

/** Movement of cost / rework across the task's attempts (LUM-562).
 *  Client mirror of the server `TrendModel`. */
export interface TrendModelView {
  cost: Array<{
    sessionId: string
    total: number
    loopCount: number
    at: string
  }>
  rework: {
    reopens: number
    extraPrCycles: number
    total: number
  }
}

export interface TaskStatusView {
  version: number
  task: { id: string; identifier: string; title: string; status: string }
  struggleTrail: StruggleTrailView
  cost: TaskCostView
  trend: TrendModelView
}
