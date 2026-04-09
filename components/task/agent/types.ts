import type { AgentEvent } from '@/lib/integrations/pusher'
import type {
  ApiPullRequest,
  ApiTaskBranch,
  ApiAgentClarify,
  ApiAgentRun,
} from '@/app/workspace/[workspaceUrl]/types'

/** Minimal clarify shape used in local panel state */
export interface AgentClarifyPending {
  id: string
  question: string
  context: string | null
}

export interface AgentStep {
  id: string
  key?: string
  text: string
  subText?: string
  elapsedMs: number
  status: 'pending' | 'done' | 'paused' | 'failed'
}

export interface AgentChangedFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
}

export interface AgentTask {
  id: string
  assignee?: { type: 'HUMAN' | 'AGENT'; agent?: { name: string } | null } | null
  agentStatus?: string | null
  agentError?: string | null
  inputReason?: string | null
  spec?: string | null
  branches?: ApiTaskBranch[]
  pullRequests?: ApiPullRequest[]
  /** Full clarify records from API — panel only reads id/question/context */
  clarifies?: ApiAgentClarify[]
  agentRuns?: ApiAgentRun[]
  project?: { workspaceId?: string }
}

export interface AgentLog {
  id: string
  type: AgentEvent['type']
  message: string
}

export type { ApiPullRequest, ApiTaskBranch, ApiAgentClarify, ApiAgentRun }
