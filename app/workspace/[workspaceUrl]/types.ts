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
  | 'sprint-detail'
  | 'milestone-detail'
  | 'ideas'
  | 'initiatives'
  | 'initiative-detail'

/**
 * A team idea as returned by `GET /api/ideas` (the pool view). Mirrors the
 * service's `PooledIdea`, with `createdAt` serialised to an ISO string and the
 * materialisation lineage a PLANNED idea carries: `planRunId` + the
 * `initiative` it fed (both null while CAPTURED).
 */
export interface ApiIdea {
  id: string
  number: number
  identifier: string
  statement: string
  status: 'CAPTURED' | 'DEVELOPING' | 'PLANNED' | 'DROPPED'
  sourceContext: string | null
  sourceSessionId: string | null
  sourceTaskId: string | null
  proposedByMemberId: string
  createdAt: string
  planRunId: string | null
  initiative: { id: string; number: number; name: string } | null
}

/**
 * A comment on an idea (LUM-680), as returned by `GET /api/ideas/[id]/comments`.
 * Flat thread — `replies` is always empty but kept so the shape matches the
 * task comment renderer. `createdAt` is an ISO string.
 */
export interface ApiIdeaComment {
  id: string
  authorActorId: string | null
  body: string
  createdAt: string
  replies: ApiIdeaComment[]
}

/**
 * One entry on an idea's activity timeline (LUM-680), from
 * `GET /api/ideas/[id]/activity`. `payload` shape depends on `type`.
 */
export interface ApiIdeaActivity {
  id: string
  type:
    | 'IDEA_CAPTURED'
    | 'STATEMENT_CHANGED'
    | 'STATUS_CHANGED'
    | 'COMMENT_ADDED'
  payload: Record<string, unknown> | null
  actorId: string | null
  createdAt: string
}

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
  parentTaskId: string | null
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
  parent?: {
    id: string
    number: number
    teamIdentifier: string
    title: string
  } | null
  _count?: { children: number }
  childrenDoneCount?: number
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
  parentTaskId: string | null
  parent?: {
    id: string
    number: number
    teamIdentifier: string
    title: string
  } | null
  assigneeActorId: string | null
  assignee: ActorInfo | null
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
    }[]
  }
  groups: LineageGroup[]
}

// ── Acceptance status read model (LUM-344 GET /api/tasks/[id]/status) ─────────
// Client mirror of lib/services/task-verification.service.ts `TaskAcceptanceStatus`
// (front end must not import lib/services). The read-only Acceptance tab
// (LUM-423) consumes it verbatim — no new backend.

export type AcceptanceVerdict = 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
export type AcceptanceVerifier = 'MACHINE' | 'HUMAN' | 'AGENT'
export type CriterionSource = 'AGENT_DRAFT' | 'HUMAN_EDIT' | 'REVIEW_ADDED'

/** One item of a human contract revision sent from the web tab. Mirrors
 *  lib/validation CriteriaSetItem (the front end must not import lib/validation). */
export interface CriteriaSetItemInput {
  id?: string
  statement: string
  verifierType: 'MACHINE' | 'HUMAN'
  checkpointer?: string | null
  evidenceRequired?: boolean
  judgeSteps?: string | null
  referentKind?: 'EXTERNAL_FACT' | 'AGENT_CONSTRUCTED_STATE' | 'PENDING_OUTCOME'
}

export interface CriterionLatestVerdictView {
  round: number
  verdict: AcceptanceVerdict
  verifierType: AcceptanceVerifier
  evidencePointer: string | null
  rejectionReason: string | null
  rejectionReasonEnum: string | null
  recordedAt: string
}

export interface TaskStatusCriterionView {
  id: string
  statement: string
  verifierType: 'MACHINE' | 'HUMAN'
  checkpointer: string | null
  evidenceRequired: boolean
  /** Agent-drafted human-judging guidance for a HUMAN criterion (LUM-465);
   *  null = none drafted → the adjudication card shows a fallback hint. */
  judgeSteps: string | null
  source: CriterionSource
  addedAtRound: number
  latestVerdict: CriterionLatestVerdictView | null
  /** Latest MACHINE-authored verdict, independent of a later HUMAN override of
   *  latestVerdict (LUM-611) — carries the checkpointer round + `cmd:` evidence
   *  so the tab shows "machine-verified @rN" even after a human PASS sign-off.
   *  null/absent when no MACHINE run exists. */
  machineVerdict?: CriterionLatestVerdictView | null
  /** LUM-602: the declarable referent kind for this criterion — what it anchors.
   *  null for legacy rows predating the field. */
  referentKind?:
    | 'EXTERNAL_FACT'
    | 'AGENT_CONSTRUCTED_STATE'
    | 'PENDING_OUTCOME'
    | null
  /** Whether a checkpointer currently vouches for this criterion — true only for
   *  a MACHINE criterion whose latest MACHINE verdict is a PASS (LUM-456). A
   *  passing MACHINE criterion with this false is carried by a human override;
   *  HUMAN criteria are always false. */
  machinePassed: boolean
  /** Latest verdict predates the criterion's last edit — the pass vouches for a
   *  stale version (LUM-457). Render-only; never makes a criterion unmet. */
  verdictStale: boolean
  /** A MACHINE criterion's current machine PASS ran a different command than the
   *  present checkpointer (LUM-457). Render-only, like verdictStale. */
  checkMismatch: boolean
  /** Whether this active criterion entered or was reworded after work started
   *  (LUM-437). 'edited' wins over 'added'; null = original untouched draft. */
  changeState: 'added' | 'edited' | null
  changedAtRound: number | null
  lastEdit: { before: string; after: string } | null
  /** LUM-511 Phase 5: send-back lifecycle — a HUMAN/AGENT FAIL now resolved
   *  (with the resolving round + best-effort closing PR) or still open; null
   *  when the criterion was never sent back. */
  sendBackResolution?: {
    status: 'open' | 'resolved'
    failedAtRound: number
    resolvedAtRound?: number
    closingPrNumber?: number
    closingPrUrl?: string
  } | null
  /** LUM-789: when a human confirmed this contract row (ISO), null = not yet
   *  confirmed. Confirmation is never a to-do and never blocks DONE — it only
   *  drives the optional "Confirm contract" affordance on this tab and the
   *  `task status` nudge. */
  confirmedAt: string | null
}

/** Honest machine-verification rollup over the active MACHINE criteria
 *  (LUM-456): genuine checkpointer passes vs human overrides. */
export interface MachineVerificationSummaryView {
  total: number
  machineVerified: number
  humanOverridden: number
}

/** A criterion removed (soft-deleted) from the contract after work started,
 *  with its preserved last verdict + run count (LUM-437). */
export interface RemovedCriterionView {
  id: string
  statement: string
  verifierType: 'MACHINE' | 'HUMAN'
  removedAtRound: number | null
  runCount: number
  lastVerdict: CriterionLatestVerdictView | null
}

export interface VerificationHistoryRoundView {
  round: number
  recordedAt: string
  passed: number
  failed: number
  verdicts: Array<{
    criterionId: string
    verdict: AcceptanceVerdict
    verifierType: AcceptanceVerifier
    evidencePointer: string | null
    rejectionReason: string | null
    rejectionReasonEnum: string | null
    /** The run's verdict action was withdrawn (LUM-586). The run stays in
     *  history; the UI badges it "withdrawn" rather than hiding it. Optional so
     *  an older server (pre-586) is tolerated — absent means not withdrawn. */
    withdrawn?: boolean
  }>
}

/** Rework / send-back / leftover traces (LUM-561) — the honest "struggle trail"
 *  a clean all-pass report would otherwise wipe. Client mirror of the server
 *  `StruggleTrail`; all arrays empty is a legitimate (honest) state. */
export interface StruggleTrailView {
  reworkRounds: Array<{ round: number; failed: number }>
  sendBacks: Array<{
    criterionId: string
    statement: string
    status: 'open' | 'resolved'
    failedAtRound: number
    resolvedAtRound: number | null
  }>
  followUps: Array<{ criterionId: string; statement: string; round: number }>
  pullRequests: Array<{ number: number; url: string }>
  reopens: Array<{ from: string; to: string; at: string }>
}

/** Honest cost read-out (LUM-560). Client mirror of the server `TaskCost`.
 *  `tokenCost` null = NOT measured (no session usage recorded) — deliberately
 *  distinct from a measured 0 (花了0 vs 没测到). */
export interface TaskCostView {
  tokenCost: number | null
  activeTimeSec: number
  reworkRounds: number
}

/** Movement of pass rate / cost / rework across the task's attempts (LUM-562).
 *  Client mirror of the server `TrendModel`. */
export interface TrendModelView {
  passRate: Array<{ round: number; passed: number; failed: number }>
  cost: Array<{
    sessionId: string
    total: number
    loopCount: number
    at: string
  }>
  rework: {
    reworkRounds: number
    reopens: number
    extraPrCycles: number
    total: number
  }
}

/** The agent's CLAIM — what it SAYS it did (LUM-564), an unverified self-report
 *  (estimate-tier). Client mirror of the server `TaskClaim`. */
export interface TaskClaimView {
  text: string | null
  // LUM-597: 'AGENT' = the agent's own verify self-report (authoritative claim);
  // RUN_SUMMARY/DIGEST = a summarizer paraphrase fallback (SYNTHESIZED).
  source: 'AGENT' | 'RUN_SUMMARY' | 'DIGEST' | null
}

/** Whether the CLAIM faithfully reflects the delivery (LUM-583) — the third
 *  state read from the persisted LUM-582 verdict. Client mirror of the server
 *  `ClaimFaithfulness`. PENDING = not yet judged (≠ UNJUDGEABLE); STALE = judged
 *  against an older claim snapshot, the verdict still surfaced. */
export interface TaskClaimFaithfulnessView {
  state:
    | 'FAITHFUL'
    | 'UNDERREPORT'
    | 'OVERSTATED'
    | 'UNJUDGEABLE'
    | 'PENDING'
    | 'STALE'
  verdict: 'FAITHFUL' | 'UNDERREPORT' | 'OVERSTATED' | 'UNJUDGEABLE' | null
  evidence: string[]
  reasoning: string | null
  diffShas: string[]
  prNumbers: number[]
  judgedAt: string | null
  judgedClaimAt: string | null
}

export interface TaskAcceptanceStatusView {
  version: number
  task: { id: string; identifier: string; title: string; status: string }
  currentRound: number
  maxRounds: number
  escalated: boolean
  /** The latest live (non-withdrawn) human verdict — the action the Undo button
   *  targets (LUM-586). Null when there is no standing human verdict to undo.
   *  Optional so an older server (pre-586) is tolerated, never fabricated. */
  undoableHumanVerdict?: {
    verdictActionId: string
    verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
    actorName: string | null
    at: string
  } | null
  /** The most-recent verdict withdrawal, feeding the "verdict withdrawn by …"
   *  correction line which must persist after undo, when undoableHumanVerdict is
   *  null (LUM-586). Optional / tolerated-absent on an older server. */
  lastVerdictWithdrawal?: {
    verdict: 'PASS' | 'FAIL' | 'PASS_WITH_FOLLOWUP'
    actorName: string | null
    at: string
  } | null
  criteria: TaskStatusCriterionView[]
  /** Honest machine-verification rollup — genuine checkpointer passes vs human
   *  overrides over the active MACHINE criteria (LUM-456). */
  machineVerification: MachineVerificationSummaryView
  /** Rework / send-back / leftover-follow-up traces (LUM-561), preserved even on
   *  a clean all-pass task. Optional so an older server (pre-561) is tolerated —
   *  the section is then skipped, never fabricated (mirrors the CLI's optionality). */
  struggleTrail?: StruggleTrailView
  /** Honest cost read-out (LUM-560) — token / active time / rework rounds, same
   *  source as the delivery card. Optional so an older server is tolerated. */
  cost?: TaskCostView
  /** Movement of pass rate / cost / rework across attempts (LUM-562). Optional so
   *  an older server is tolerated. */
  trend?: TrendModelView
  /** The agent's CLAIM — what it SAYS it did (LUM-564), surfaced beside the
   *  measured verdict (声称 vs 核验). Optional so an older server is tolerated. */
  claim?: TaskClaimView
  /** Whether the claim faithfully reflects the delivery (LUM-583) — the third
   *  state over the two columns. Optional so an older server (pre-583) is
   *  tolerated; the chip is then simply not rendered, never fabricated. */
  faithfulness?: TaskClaimFaithfulnessView
  /** Criteria removed from the contract after work started (LUM-437). */
  removedCriteria: RemovedCriterionView[]
  verificationHistory: VerificationHistoryRoundView[]
  lastRoundFailures: Array<{
    criterionId: string
    statement: string
    rejectionReason: string | null
    rejectionReasonEnum: string | null
  }>
  /** LUM-737: `kind` discriminates criteria from security findings; a missing
   *  kind (older server) means CRITERION. */
  nextActions: Array<
    | {
        kind?: 'CRITERION'
        criterionId: string
        statement: string
        verifierType: 'MACHINE' | 'HUMAN'
        checkpointer: string | null
        judgeSteps: string | null
        source: CriterionSource
        addedAtRound: number
        rejectionReason: string | null
      }
    | {
        kind: 'SECURITY_FINDING'
        findingId: string
        statement: string
        severity: 'LOW' | 'MEDIUM' | 'HIGH'
        provenance: 'DETERMINISTIC' | 'LLM_JUDGE' | 'EXTERNAL_TOOL'
        blocking: boolean
        prNumber: number
        ruleId: string
        filePath: string
        line: number | null
      }
  >
  /** LUM-737: null = the scan read failed (could not confirm). Optional so an
   *  older server is tolerated. */
  securityFindings?: {
    open: number
    blocking: number
    unconfirmedPrs: Array<{
      number: number
      reason: 'NONE' | 'FAILED' | 'PENDING' | 'RUNNING'
    }>
  } | null
}
