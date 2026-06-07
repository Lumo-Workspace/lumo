/**
 * @jest-environment node
 *
 * Verifies that processAgentCompletion parses `resultLine` via
 * parseStreamJsonUsage and places the resulting RunUsage (or null) onto the
 * RunContext that is passed into processPostAgent.
 *
 * What is NOT tested here:
 * - The downstream persistence of ctx.usage by markRunCompleted is exercised
 *   by the three call sites in lib/agent/github-pr.ts (completeAgentRun →
 *   markRunCompleted).
 * - The parsing logic itself is unit-tested in
 *   __tests__/shared/stream-json-usage.test.ts.
 */

// ── Heavy dependencies mocked before import ──────────────────────────────

jest.mock('@e2b/code-interpreter', () => ({
  Sandbox: { connect: jest.fn(() => Promise.resolve({ kill: jest.fn() })) },
}))

jest.mock('@/lib/db/prisma', () => ({
  prisma: {
    agentRun: {
      findUnique: jest.fn(),
    },
    agentClarify: {
      findFirst: jest.fn(),
    },
    task: {
      findUnique: jest.fn(),
    },
  },
}))

jest.mock('@/lib/integrations/github', () => ({
  getGithubInstallationToken: jest.fn().mockResolvedValue('gh-token'),
}))

jest.mock('@/lib/integrations/sandbox', () => ({
  installMcpServer: jest.fn(),
}))

jest.mock('@/lib/agent/run-lifecycle', () => ({
  loadTask: jest.fn(),
  createAgentRun: jest.fn(),
  markFailed: jest.fn(),
  markRunCanceled: jest.fn(),
  markRunCompleted: jest.fn(),
}))

jest.mock('@/lib/agent/pipeline', () => ({
  fireProgress: jest.fn(),
  writeTaskSpec: jest.fn(),
  writeAgentScript: jest.fn(),
  finalizeClarify: jest.fn(),
  runStepTimers: { set: jest.fn(), delete: jest.fn() },
}))

jest.mock('@/lib/agent/sandbox', () => ({
  createSandbox: jest.fn(),
  cloneRepo: jest.fn(),
  installClaude: jest.fn(),
  checkoutBranch: jest.fn(),
}))

jest.mock('@/lib/agent/post-agent', () => ({
  processPostAgent: jest.fn(),
}))

jest.mock('@/lib/utils/markdown', () => ({
  htmlToMarkdown: jest.fn((s: string) => s),
}))

jest.mock('@/lib/agent/generate-spec', () => ({
  generateSpecDraft: jest.fn(),
}))

// ── Now import real code ─────────────────────────────────────────────────

import { processAgentCompletion } from '@/lib/agent/execute'
import { loadTask } from '@/lib/agent/run-lifecycle'
import { prisma } from '@/lib/db/prisma'
import { processPostAgent } from '@/lib/agent/post-agent'

const mockLoadTask = loadTask as jest.Mock
// markRunCompleted is mocked (via jest.mock above) to prevent real DB calls,
// but is not asserted here — its usage threading is covered at the call sites.
const mockProcessPostAgent = processPostAgent as jest.Mock
const mockAgentRunFindUnique = prisma.agentRun.findUnique as jest.Mock
const mockClarifyFindFirst = prisma.agentClarify.findFirst as jest.Mock
const mockTaskFindUnique = prisma.task.findUnique as jest.Mock

// ── Fixtures ─────────────────────────────────────────────────────────────

const RESULT_LINE = JSON.stringify({
  type: 'result',
  num_turns: 7,
  usage: {
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_input_tokens: 200,
    cache_creation_input_tokens: 100,
  },
})

function makeTask() {
  return {
    id: 'task-1',
    number: 42,
    title: 'Fix login bug',
    description: 'desc',
    spec: null,
    status: 'IN_PROGRESS',
    agentStatus: 'WORKING',
    agentRuns: [],
    pullRequests: [],
    branches: [],
    repository: { fullName: 'org/repo' },
    project: {
      id: 'proj-1',
      workspaceId: 'ws-1',
      repositories: [{ fullName: 'org/repo' }],
    },
  }
}

function makeRun() {
  return {
    startedAt: new Date(Date.now() - 60_000),
    sandboxId: null,
  }
}

const BASE_PARAMS = {
  runId: 'run-1',
  taskId: 'task-1',
  exitCode: 0,
  timedOut: false,
  stderr: '',
  branchExistsOnRemote: false,
}

// ── Helpers ───────────────────────────────────────────────────────────────

function setupSuccess() {
  mockLoadTask.mockResolvedValue(makeTask())
  mockAgentRunFindUnique.mockResolvedValue(makeRun())
  mockClarifyFindFirst.mockResolvedValue(null) // no pending clarify
  mockTaskFindUnique.mockResolvedValue({ agentStatus: 'WORKING' }) // not CANCELED
  mockProcessPostAgent.mockResolvedValue({
    outcome: 'done',
    prUrl: 'u',
    prNumber: 1,
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('processAgentCompletion — usage parsed onto RunContext', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('passes parsed usage into processPostAgent ctx when resultLine is provided', async () => {
    setupSuccess()

    await processAgentCompletion({ ...BASE_PARAMS, resultLine: RESULT_LINE })

    // processPostAgent receives a ctx; capture it
    expect(mockProcessPostAgent).toHaveBeenCalledTimes(1)
    const ctx = mockProcessPostAgent.mock.calls[0][0]
    expect(ctx.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheCreationTokens: 100,
      loopCount: 7,
    })
  })

  it('sets ctx.usage to null when no resultLine is provided', async () => {
    setupSuccess()

    await processAgentCompletion(BASE_PARAMS)

    expect(mockProcessPostAgent).toHaveBeenCalledTimes(1)
    const ctx = mockProcessPostAgent.mock.calls[0][0]
    expect(ctx.usage).toBeNull()
  })

  it('sets ctx.usage to null when resultLine is not a valid result JSON', async () => {
    setupSuccess()

    await processAgentCompletion({
      ...BASE_PARAMS,
      resultLine: '{"type":"message","content":"hello"}',
    })

    expect(mockProcessPostAgent).toHaveBeenCalledTimes(1)
    const ctx = mockProcessPostAgent.mock.calls[0][0]
    expect(ctx.usage).toBeNull()
  })
})
