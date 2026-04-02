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
    'Agent timed out after 28 minutes. The task may be too complex — try breaking it down.',
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
