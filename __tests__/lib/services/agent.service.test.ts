/**
 * @jest-environment node
 */

// `@/lib/services/agent-orchestration.service` is a barrel that re-exports
// from agent/execute, agent/comment-handler, sandbox/index, etc. — each of
// which transitively pulls ESM-only packages (@e2b/code-interpreter → chalk,
// @octokit/auth-app → universal-user-agent) that Jest's CJS transformer
// can't parse. Mock the entire barrel so `agent.service.ts` picks up our
// stubs instead of evaluating the real module chain.
jest.mock('@/lib/services/agent-orchestration.service', () => ({
  transitionAgentStatus: jest.fn(),
  clearAgentStatus: jest.fn(),
  isValidTransition: jest.fn(),
  executeAgent: jest.fn(),
  processAgentCompletion: jest.fn(),
  handleAgentComment: jest.fn(),
  extractAgentInstruction: jest.fn(),
  buildAgentSpec: jest.fn(),
}))

jest.mock('@/lib/repositories/agent.repository', () => ({
  agentRepository: {
    findActiveRun: jest.fn(),
    cancelRun: jest.fn(),
    failRun: jest.fn(),
    findTimedOutTasks: jest.fn(),
  },
}))

jest.mock('@/lib/integrations/pusher', () => ({
  pushAgentEvent: jest.fn(),
}))

import { agentRepository } from '@/lib/repositories/agent.repository'
import { transitionAgentStatus } from '@/lib/services/agent-orchestration.service'
import { pushAgentEvent } from '@/lib/integrations/pusher'
import { agentService } from '@/lib/services/agent.service'

const mockFindActiveRun = agentRepository.findActiveRun as jest.Mock
const mockCancelRun = agentRepository.cancelRun as jest.Mock
const mockFailRun = agentRepository.failRun as jest.Mock
const mockFindTimedOutTasks = agentRepository.findTimedOutTasks as jest.Mock
const mockTransition = transitionAgentStatus as jest.Mock
const mockPushEvent = pushAgentEvent as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('agentService.cancelAgent', () => {
  it('transitions status, cancels run, and pushes event', async () => {
    const activeRun = { id: 'run-1', sandboxId: 'sb-123' }
    mockFindActiveRun.mockResolvedValue(activeRun)

    const result = await agentService.cancelAgent('task-1', 'proj-1', 'WORKING')

    expect(mockFindActiveRun).toHaveBeenCalledWith('task-1')
    expect(mockTransition).toHaveBeenCalledWith(
      'task-1',
      'proj-1',
      'CANCELED',
      {
        currentStatus: 'WORKING',
      }
    )
    expect(mockCancelRun).toHaveBeenCalledWith('run-1')
    expect(mockPushEvent).toHaveBeenCalledWith('task-1', {
      type: 'agent:failed',
      error: 'Cancelled by user',
    })
    expect(result).toEqual(activeRun)
  })

  it('skips cancelRun when no active run exists', async () => {
    mockFindActiveRun.mockResolvedValue(null)

    const result = await agentService.cancelAgent(
      'task-1',
      'proj-1',
      'INPUT_REQUIRED'
    )

    expect(mockTransition).toHaveBeenCalled()
    expect(mockCancelRun).not.toHaveBeenCalled()
    expect(mockPushEvent).toHaveBeenCalled()
    expect(result).toBeNull()
  })
})

describe('agentService.timeoutTask', () => {
  it('transitions status to FAILED and fails the run', async () => {
    const activeRun = { id: 'run-1', sandboxId: 'sb-456' }
    mockFindActiveRun.mockResolvedValue(activeRun)

    const result = await agentService.timeoutTask('task-1', 'proj-1')

    expect(mockFindActiveRun).toHaveBeenCalledWith('task-1')
    expect(mockTransition).toHaveBeenCalledWith('task-1', 'proj-1', 'FAILED', {
      agentError: 'CLARIFY_TIMEOUT',
      currentStatus: 'INPUT_REQUIRED',
    })
    expect(mockFailRun).toHaveBeenCalledWith(
      'run-1',
      'CLARIFY_TIMEOUT',
      'Agent was waiting for clarification for 24 hours and has been stopped.'
    )
    expect(mockPushEvent).toHaveBeenCalledWith('task-1', {
      type: 'agent:failed',
      error:
        'Agent was waiting for clarification for 24 hours and has been stopped. Add more details to the spec and retry.',
    })
    expect(result).toEqual(activeRun)
  })

  it('skips failRun when no active run exists', async () => {
    mockFindActiveRun.mockResolvedValue(null)

    const result = await agentService.timeoutTask('task-1', 'proj-1')

    expect(mockTransition).toHaveBeenCalled()
    expect(mockFailRun).not.toHaveBeenCalled()
    expect(mockPushEvent).toHaveBeenCalled()
    expect(result).toBeNull()
  })
})

describe('agentService.findTimedOutTasks', () => {
  it('delegates to agentRepository', async () => {
    const tasks = [{ id: 'task-1', projectId: 'proj-1' }]
    mockFindTimedOutTasks.mockResolvedValue(tasks)

    const result = await agentService.findTimedOutTasks()

    expect(result).toEqual(tasks)
    expect(mockFindTimedOutTasks).toHaveBeenCalled()
  })
})
