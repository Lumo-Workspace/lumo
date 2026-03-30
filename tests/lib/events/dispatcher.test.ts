import type { DomainEvent } from '@/lib/events/types'

// ── Mock handler registry ─────────────────────────────────────────────────

// Use module-level jest.fn() via a shared object to avoid hoisting issues
const mocks = {
  agentHandler1: jest.fn(),
  agentHandler2: jest.fn(),
  taskHandler: jest.fn(),
}

jest.mock('@/lib/events/handlers', () => ({
  get registry() {
    return {
      'agent:status_changed': [mocks.agentHandler1, mocks.agentHandler2],
      'task:status_changed': [mocks.taskHandler],
    }
  },
}))

import { dispatchEvents } from '@/lib/events/dispatcher'

// ── Fixtures ──────────────────────────────────────────────────────────────

const agentEvent: DomainEvent = {
  type: 'agent:status_changed',
  taskId: 'task-1',
  projectId: 'proj-1',
  from: 'IDLE',
  to: 'RUNNING',
  fields: ['agentStatus'],
  patch: { agentStatus: 'RUNNING' },
}

const taskEvent: DomainEvent = {
  type: 'task:status_changed',
  taskId: 'task-1',
  projectId: 'proj-1',
  from: 'TODO',
  to: 'IN_REVIEW',
}

// ── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  mocks.agentHandler1.mockResolvedValue(undefined)
  mocks.agentHandler2.mockResolvedValue(undefined)
  mocks.taskHandler.mockResolvedValue(undefined)
})

describe('dispatchEvents', () => {
  it('calls all registered handlers for an event type', async () => {
    await dispatchEvents([agentEvent])

    expect(mocks.agentHandler1).toHaveBeenCalledWith(agentEvent)
    expect(mocks.agentHandler2).toHaveBeenCalledWith(agentEvent)
    expect(mocks.taskHandler).not.toHaveBeenCalled()
  })

  it('dispatches multiple events sequentially', async () => {
    await dispatchEvents([agentEvent, taskEvent])

    expect(mocks.agentHandler1).toHaveBeenCalledTimes(1)
    expect(mocks.agentHandler2).toHaveBeenCalledTimes(1)
    expect(mocks.taskHandler).toHaveBeenCalledTimes(1)
  })

  it('retries once on handler failure then succeeds', async () => {
    mocks.agentHandler1
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined)

    await dispatchEvents([agentEvent])

    expect(mocks.agentHandler1).toHaveBeenCalledTimes(2)
    expect(mocks.agentHandler2).toHaveBeenCalledTimes(1)
  })

  it('logs error after retry failure but does not throw', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    mocks.agentHandler1
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))

    await dispatchEvents([agentEvent])

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Handler failed after retry'),
      expect.any(Error)
    )
    // Other handlers still ran
    expect(mocks.agentHandler2).toHaveBeenCalledTimes(1)
    consoleSpy.mockRestore()
  })

  it('does nothing for empty event array', async () => {
    await dispatchEvents([])

    expect(mocks.agentHandler1).not.toHaveBeenCalled()
  })

  it('runs handlers in parallel for the same event', async () => {
    const order: string[] = []
    mocks.agentHandler1.mockImplementation(async () => {
      order.push('h1-start')
      await new Promise(r => setTimeout(r, 10))
      order.push('h1-end')
    })
    mocks.agentHandler2.mockImplementation(async () => {
      order.push('h2-start')
      await new Promise(r => setTimeout(r, 5))
      order.push('h2-end')
    })

    await dispatchEvents([agentEvent])

    // Both should start before either ends (parallel)
    expect(order[0]).toBe('h1-start')
    expect(order[1]).toBe('h2-start')
  })
})
