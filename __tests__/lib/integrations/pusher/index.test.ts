import {
  pushAgentEvent,
  fireAgentEvent,
  pushTaskEvent,
  pushProjectEvent,
  pushUserEvent,
  pushActivityEvent,
} from '@/lib/integrations/pusher'
import type {
  AgentEvent,
  TaskEvent,
  ProjectEvent,
  UserEvent,
  ActivityPusherEvent,
} from '@/lib/integrations/pusher'

jest.mock('pusher', () => {
  return jest.fn().mockImplementation(() => ({
    trigger: jest.fn().mockResolvedValue({}),
  }))
})

describe('lib/integrations/pusher', () => {
  describe('exports', () => {
    it('exports pushAgentEvent as a function', () => {
      expect(typeof pushAgentEvent).toBe('function')
    })

    it('exports fireAgentEvent as a function', () => {
      expect(typeof fireAgentEvent).toBe('function')
    })

    it('exports pushTaskEvent as a function', () => {
      expect(typeof pushTaskEvent).toBe('function')
    })

    it('exports pushProjectEvent as a function', () => {
      expect(typeof pushProjectEvent).toBe('function')
    })

    it('exports pushUserEvent as a function', () => {
      expect(typeof pushUserEvent).toBe('function')
    })

    it('exports pushActivityEvent as a function', () => {
      expect(typeof pushActivityEvent).toBe('function')
    })
  })

  describe('pushAgentEvent', () => {
    it('resolves without throwing for agent:thinking event', async () => {
      const event: AgentEvent = {
        type: 'agent:thinking',
        message: 'thinking...',
      }
      await expect(pushAgentEvent('task-123', event)).resolves.toBeUndefined()
    })

    it('resolves without throwing for agent:done event', async () => {
      const event: AgentEvent = {
        type: 'agent:done',
        prUrl: 'https://github.com/org/repo/pull/1',
        prNumber: 1,
      }
      await expect(pushAgentEvent('task-123', event)).resolves.toBeUndefined()
    })

    it('resolves without throwing for agent:failed event', async () => {
      const event: AgentEvent = {
        type: 'agent:failed',
        error: 'something went wrong',
      }
      await expect(pushAgentEvent('task-123', event)).resolves.toBeUndefined()
    })
  })

  describe('fireAgentEvent', () => {
    it('does not throw for agent:progress event', () => {
      const event: AgentEvent = { type: 'agent:progress', message: 'step 1' }
      expect(() => fireAgentEvent('task-456', event)).not.toThrow()
    })
  })

  describe('pushTaskEvent', () => {
    it('resolves without throwing for comment:created event', async () => {
      const event: TaskEvent = { type: 'comment:created', commentId: 'c-1' }
      await expect(pushTaskEvent('task-123', event)).resolves.toBeUndefined()
    })

    it('resolves without throwing for task:updated event', async () => {
      const event: TaskEvent = {
        type: 'task:updated',
        fields: ['status', 'assignee'],
      }
      await expect(pushTaskEvent('task-123', event)).resolves.toBeUndefined()
    })
  })

  describe('pushProjectEvent', () => {
    it('resolves without throwing', async () => {
      const event: ProjectEvent = {
        type: 'task:updated',
        taskId: 'task-1',
        fields: ['status'],
      }
      await expect(pushProjectEvent('proj-1', event)).resolves.toBeUndefined()
    })
  })

  describe('pushUserEvent', () => {
    it('resolves without throwing for notification:new event', async () => {
      const event: UserEvent = { type: 'notification:new' }
      await expect(
        pushUserEvent('clerk-user-id', event)
      ).resolves.toBeUndefined()
    })
  })

  describe('pushActivityEvent', () => {
    it('resolves without throwing', async () => {
      const entry: ActivityPusherEvent['entry'] = {
        action: 'created',
        taskId: 'task-1',
      }
      await expect(
        pushActivityEvent('task-123', entry)
      ).resolves.toBeUndefined()
    })
  })
})
