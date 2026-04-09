// State machine
export {
  transitionAgentStatus,
  clearAgentStatus,
  isValidTransition,
} from '@/lib/agent/state-machine'
export type {
  AgentStatusValue,
  TransitionOptions,
} from '@/lib/agent/state-machine'

// Execution
export { executeAgent, processAgentCompletion } from '@/lib/agent/execute'
export type { AgentResult, ExecuteAgentOptions } from '@/lib/agent/execute'

// Comment handling
export {
  handleAgentComment,
  extractAgentInstruction,
  buildAgentSpec,
} from '@/lib/agent/comment-handler'
export type { HandleAgentCommentOptions } from '@/lib/agent/comment-handler'

// Context
export { buildAgentContext } from '@/lib/agent/context-builder'

// Errors
export { AgentError, userFriendlyError } from '@/lib/agent/errors'
export type { AgentErrorCode } from '@/lib/agent/errors'
