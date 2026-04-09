/**
 * Verifies that lib/integrations/sandbox barrel exports all public symbols.
 */

jest.mock('@e2b/code-interpreter', () => ({
  Sandbox: { connect: jest.fn() },
}))

import {
  installMcpServer,
  MCP_CONFIG_PATH,
  isSandboxAlive,
  isAgentServiceEnabled,
  proxyToAgentService,
} from '@/lib/integrations/sandbox'
import type {
  McpEnvVars,
  SandboxExecutionParams,
  SandboxExecutionResult,
} from '@/lib/integrations/sandbox'

describe('lib/integrations/sandbox barrel exports', () => {
  it('exports installMcpServer as a function', () => {
    expect(typeof installMcpServer).toBe('function')
  })

  it('exports MCP_CONFIG_PATH as a string', () => {
    expect(typeof MCP_CONFIG_PATH).toBe('string')
    expect(MCP_CONFIG_PATH).toBe('/home/user/mcp-config.json')
  })

  it('exports isSandboxAlive as a function', () => {
    expect(typeof isSandboxAlive).toBe('function')
  })

  it('exports isAgentServiceEnabled as a function', () => {
    expect(typeof isAgentServiceEnabled).toBe('function')
  })

  it('exports proxyToAgentService as a function', () => {
    expect(typeof proxyToAgentService).toBe('function')
  })

  it('McpEnvVars type is correctly shaped (runtime check via object assignment)', () => {
    // Type-level check — if this compiles, the type is exported correctly
    const env: McpEnvVars = {
      callbackUrl: 'https://example.com',
      taskId: 'task-1',
    }
    expect(env.callbackUrl).toBe('https://example.com')
    expect(env.taskId).toBe('task-1')
    expect(env.callbackToken).toBeUndefined()
  })

  it('SandboxExecutionParams type includes required fields (compile-time check)', () => {
    const params: SandboxExecutionParams = {
      repoUrl: 'https://github.com/org/repo',
      branch: 'main',
      githubToken: 'gh_token',
      anthropicKey: 'sk-ant-key',
      taskSpec: 'Do the thing',
      agentContext: 'context',
      allowedTools: ['Read', 'Edit'],
      mcpEnv: { callbackUrl: 'https://example.com', taskId: 'task-1' },
      gitName: 'Bot',
      gitEmail: 'bot@example.com',
    }
    expect(params.repoUrl).toBeDefined()
  })

  it('SandboxExecutionResult type includes exitCode, stdout, stderr', () => {
    const result: SandboxExecutionResult = {
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
    }
    expect(result.exitCode).toBe(0)
  })
})
