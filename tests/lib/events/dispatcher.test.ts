import { dispatchEvents } from '@/lib/events/dispatcher'
import type { DomainEvent } from '@/lib/events/types'

// ── Mock handler registry ─────────────────────────────────────────────────

const mockHandler1 = jest.fn<Promise<void>, [DomainEvent]>()
const mockHandler2 = jest.fn<Promise<void>, [DomainEvent]>()

jest.mock('@/lib/events/handlers', () => ({
  getHandlers: jest.fn((type: string) => {
    if (type === 'agent:status_changed') return [mockHandler1, mockHandler2]
    if (type === 'task:status_changed') return [mockHandler1]
    return []
  }),
}))

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
  mockHandler1.mockResolvedValue(undefined)
  mockHandler2.mockResolvedValue(undefined)
})

describe('dispatchEvents', () => {
  it('calls all registered handlers for an event type', async () => {
    await dispatchEvents([agentEvent])

    expect(mockHandler1).toHaveBeenCalledWith(agentEvent)
    expect(mockHandler2).toHaveBeenCalledWith(agentEvent)
  })

  it('dispatches multiple events sequentially', async () => {
    await dispatchEvents([agentEvent, taskEvent])

    expect(mockHandler1).toHaveBeenCalledTimes(2)
    expect(mockHandler2).toHaveBeenCalledTimes(1) // only registered for agent events
  })

  it('retries once on handler failure then succeeds', async () => {
    mockHandler1
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined)

    await dispatchEvents([agentEvent])

    expect(mockHandler1).toHaveBeenCalledTimes(2)
    expect(mockHandler2).toHaveBeenCalledTimes(1)
  })

  it('logs error after retry failure but does not throw', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
    mockHandler1
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))

    await dispatchEvents([agentEvent])

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Handler failed after retry'),
      expect.any(Error)
    )
    // Other handlers still ran
    expect(mockHandler2).toHaveBeenCalledTimes(1)
    consoleSpy.mockRestore()
  })

  it('does nothing for empty event array', async () => {
    await dispatchEvents([])

    expect(mockHandler1).not.toHaveBeenCalled()
  })

  it('runs handlers in parallel for the same event', async () => {
    const order: string[] = []
    mockHandler1.mockImplementation(async () => {
      order.push('h1-start')
      await new Promise(r => setTimeout(r, 10))
      order.push('h1-end')
    })
    mockHandler2.mockImplementation(async () => {
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
