// ── Agent Error types ────────────────────────────────────────────────────────

export type AgentErrorCode =
  | 'SANDBOX_CREATE_FAILED'
  | 'CLONE_FAILED'
  | 'AGENT_EXECUTION_FAILED'
  | 'PUSH_FAILED'
  | 'PR_CREATE_FAILED'
  | 'TIMEOUT'
  | 'CLARIFY_TIMEOUT'
  | 'SANDBOX_KILLED'
  | 'CONFIG_ERROR'
  | 'UNKNOWN_ERROR'

export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

const USER_MESSAGES: Record<AgentErrorCode, string> = {
  SANDBOX_CREATE_FAILED:
    'Could not start the execution environment. Please try again.',
  CLONE_FAILED:
    'Could not access the repository. Check your GitHub connection.',
  AGENT_EXECUTION_FAILED: 'Agent encountered an error while writing code.',
  PUSH_FAILED: 'Could not push to GitHub. Check repository permissions.',
  PR_CREATE_FAILED: 'Code was written but PR creation failed. Check GitHub.',
  TIMEOUT:
    'Agent timed out after 10 minutes. The task may be too complex — try breaking it down.',
  CLARIFY_TIMEOUT:
    'Agent was waiting for clarification for 24 hours and has been stopped. Add more details to the spec and retry.',
  SANDBOX_KILLED:
    'The execution environment was shut down unexpectedly. This usually means the task took too long. Try breaking it into smaller steps.',
  CONFIG_ERROR:
    'Server configuration error. Please contact your administrator.',
  UNKNOWN_ERROR: 'Something went wrong. Please try again.',
}

export function userFriendlyError(code: string): string {
  return USER_MESSAGES[code as AgentErrorCode] ?? USER_MESSAGES.UNKNOWN_ERROR
}

// ���─ Domain event types ───────────────────────────────────────────────────────

export type AgentStatusChangedEvent = {
  type: 'agent:status_changed'
  taskId: string
  projectId: string
  from: string | null
  to: string | null
  /** DB fields updated alongside agentStatus */
  fields: string[]
  /** Patch payload forwarded to the broadcast handler */
  patch: Record<string, unknown>
}

export type TaskStatusChangedEvent = {
  type: 'task:status_changed'
  taskId: string
  projectId: string
  from: string
  to: string
}

export type DomainEvent = AgentStatusChangedEvent | TaskStatusChangedEvent

export type AgentEventHandler = (
  event: AgentStatusChangedEvent
) => Promise<void>
export type TaskEventHandler = (event: TaskStatusChangedEvent) => Promise<void>

export type EventHandlerRegistry = {
  'agent:status_changed': AgentEventHandler[]
  'task:status_changed': TaskEventHandler[]
}

// ── Agent Server API contract ────────────────────────────────────────────────

export interface ExecuteAgentRequest {
  taskId: string
  actorClerkId: string
  actorName?: string
  actorEmail?: string
  trigger?: string
}

export interface ExecuteAgentResponse {
  outcome:
    | 'started'
    | 'done'
    | 'failed'
    | 'clarify'
    | 'no_changes'
    | 'spec_review'
  prUrl?: string
  prNumber?: number
  error?: string
  question?: string
}

export interface SandboxDoneRequest {
  runId: string
  taskId: string
  exitCode: number
  timedOut: boolean
  stderr: string
  branchExistsOnRemote: boolean
}

export interface RetryAgentRequest {
  taskId: string
  actorClerkId: string
}

// ── Markdown ↔ Tiptap converter ───────────────────────────────────────────────
export {
  markdownToTiptap,
  tiptapToMarkdown,
  type TiptapNode,
  type TiptapDoc,
} from './markdown-tiptap'

// ── Stream-json run usage parser ──────────────────────────────────────────────
export { parseStreamJsonUsage } from './stream-json-usage'
export type { RunUsage } from './stream-json-usage'

// ── Untrusted free-text sanitization ─────────────────────────────────────────
export { sanitizeField } from './sanitize'

// ── Acceptance verification evidence-pointer grammar ─────────────────────────
export {
  EVIDENCE_POINTER_PATTERNS,
  EVIDENCE_POINTER_FORMAT_HINT,
  EVIDENCE_POINTER_MAX,
  isValidEvidencePointer,
  buildCmdEvidencePointer,
} from './acceptance-evidence'

// ── Agent-facing CLI output-token budget (LUM-428) ───────────────────────────
export {
  estimateTokens,
  OUTPUT_TOKEN_BUDGET,
  truncateUnitsToBudget,
  capRenderedOutput,
  type CapResult,
  type TruncateUnitsParams,
  type CapTextOptions,
} from './output-budget'

// ── Memory code-anchor staleness detection (LUM-547) ─────────────────────────
export {
  extractAnchors,
  classifyMemoryStaleness,
  type AnchorKind,
  type CodeAnchor,
  type AnchorProbe,
  type StaleVerdict,
} from './code-anchor'

// ── Test case run evidence (read side) (LUM-805) ─────────────────────────────
export {
  parseEvidenceEntries,
  isImageEvidence,
  evidenceLabel,
  type EvidenceEntry,
  type EvidenceFile,
  type EvidenceLink,
} from './test-case-evidence'
