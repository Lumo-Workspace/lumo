export interface McpEnvVars {
  callbackUrl: string
  callbackToken?: string | undefined
  taskId: string
}

export interface SandboxExecutionParams {
  repoUrl: string
  branch: string
  githubToken: string
  anthropicKey: string
  taskSpec: string
  agentContext: string
  allowedTools: string[]
  mcpEnv: McpEnvVars
  gitName: string
  gitEmail: string
  timeoutMs?: number
}

export interface SandboxExecutionResult {
  exitCode: number
  stdout: string
  stderr: string
}
