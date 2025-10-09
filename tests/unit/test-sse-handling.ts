/**
 * Unit test for Server-Sent Events handling
 * Tests the SSE utility functions and event broadcasting
 */

import { ProfileUpdateEventManager } from '@/lib/realtime/profile-events'

// Mock the events module
jest.mock('@/lib/realtime/events', () => ({
  triggerProfileUpdate: jest.fn(),
}))

const mockTriggerProfileUpdate =
  require('@/lib/realtime/events').triggerProfileUpdate

describe('Server-Sent Events Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('ProfileUpdateEventManager', () => {
    let eventManager: ProfileUpdateEventManager

    beforeEach(() => {
      eventManager = new ProfileUpdateEventManager()
    })

    it('should create a new instance', () => {
      expect(eventManager).toBeInstanceOf(ProfileUpdateEventManager)
    })

    it('should add a new connection', () => {
      const mockController = new AbortController()
      const userId = 'user-123'

      eventManager.addConnection(userId, mockController)

      expect(eventManager.getConnectionCount()).toBe(1)
    })

    it('should remove a connection', () => {
      const mockController = new AbortController()
      const userId = 'user-123'

      eventManager.addConnection(userId, mockController)
      expect(eventManager.getConnectionCount()).toBe(1)

      eventManager.removeConnection(userId)
      expect(eventManager.getConnectionCount()).toBe(0)
    })

    it('should broadcast profile updates to all connections', () => {
      const mockController1 = new AbortController()
      const mockController2 = new AbortController()
      const userId1 = 'user-123'
      const userId2 = 'user-456'

      eventManager.addConnection(userId1, mockController1)
      eventManager.addConnection(userId2, mockController2)

      const updateData = {
        displayName: 'Updated Name',
        avatarUrl: 'https://example.com/avatar.jpg',
      }

      eventManager.broadcastProfileUpdate('user-123', updateData)

      expect(mockTriggerProfileUpdate).toHaveBeenCalledWith(
        'user-123',
        updateData
      )
    })

    it('should handle broadcast to empty connection list', () => {
      const updateData = {
        displayName: 'Updated Name',
      }

      // Should not throw error when no connections exist
      expect(() => {
        eventManager.broadcastProfileUpdate('user-123', updateData)
      }).not.toThrow()

      expect(mockTriggerProfileUpdate).toHaveBeenCalledWith(
        'user-123',
        updateData
      )
    })

    it('should get connection count correctly', () => {
      expect(eventManager.getConnectionCount()).toBe(0)

      const mockController1 = new AbortController()
      const mockController2 = new AbortController()

      eventManager.addConnection('user-1', mockController1)
      expect(eventManager.getConnectionCount()).toBe(1)

      eventManager.addConnection('user-2', mockController2)
      expect(eventManager.getConnectionCount()).toBe(2)

      eventManager.removeConnection('user-1')
      expect(eventManager.getConnectionCount()).toBe(1)
    })

    it('should handle duplicate connections for same user', () => {
      const mockController1 = new AbortController()
      const mockController2 = new AbortController()
      const userId = 'user-123'

      eventManager.addConnection(userId, mockController1)
      eventManager.addConnection(userId, mockController2) // Should replace the first

      expect(eventManager.getConnectionCount()).toBe(1)
    })

    it('should clean up aborted connections', () => {
      const mockController = new AbortController()
      const userId = 'user-123'

      eventManager.addConnection(userId, mockController)
      expect(eventManager.getConnectionCount()).toBe(1)

      // Simulate connection abort
      mockController.abort()

      // The manager should detect and clean up aborted connections
      eventManager.cleanupAbortedConnections()
      expect(eventManager.getConnectionCount()).toBe(0)
    })
  })

  describe('SSE Event Formatting', () => {
    it('should format connection established event correctly', () => {
      const eventData = {
        type: 'connection_established',
        timestamp: new Date(),
        message: 'Connected to profile updates',
      }

      const formattedEvent = `event: connection_established\ndata: ${JSON.stringify(eventData)}\n\n`

      expect(formattedEvent).toContain('event: connection_established')
      expect(formattedEvent).toContain('data: {"type":"connection_established"')
      expect(formattedEvent).toContain(
        '"message":"Connected to profile updates"'
      )
    })

    it('should format profile update event correctly', () => {
      const eventData = {
        type: 'profile_updated',
        userId: 'user-123',
        changes: {
          displayName: 'Updated Name',
          avatarUrl: 'https://example.com/avatar.jpg',
        },
        timestamp: new Date(),
      }

      const formattedEvent = `event: profile_updated\ndata: ${JSON.stringify(eventData)}\n\n`

      expect(formattedEvent).toContain('event: profile_updated')
      expect(formattedEvent).toContain('"userId":"user-123"')
      expect(formattedEvent).toContain('"displayName":"Updated Name"')
      expect(formattedEvent).toContain(
        '"avatarUrl":"https://example.com/avatar.jpg"'
      )
    })

    it('should format error event correctly', () => {
      const eventData = {
        type: 'error',
        error: 'Connection failed',
        code: 'CONNECTION_ERROR',
        timestamp: new Date(),
      }

      const formattedEvent = `event: error\ndata: ${JSON.stringify(eventData)}\n\n`

      expect(formattedEvent).toContain('event: error')
      expect(formattedEvent).toContain('"error":"Connection failed"')
      expect(formattedEvent).toContain('"code":"CONNECTION_ERROR"')
    })
  })

  describe('SSE Connection Management', () => {
    it('should handle connection timeout', () => {
      const eventManager = new ProfileUpdateEventManager()
      const mockController = new AbortController()
      const userId = 'user-123'

      eventManager.addConnection(userId, mockController)

      // Simulate timeout
      setTimeout(() => {
        mockController.abort()
      }, 100)

      return new Promise<void>(resolve => {
        setTimeout(() => {
          eventManager.cleanupAbortedConnections()
          expect(eventManager.getConnectionCount()).toBe(0)
          resolve()
        }, 150)
      })
    })

    it('should handle multiple users with multiple connections', () => {
      const eventManager = new ProfileUpdateEventManager()

      // Add multiple connections for different users
      eventManager.addConnection('user-1', new AbortController())
      eventManager.addConnection('user-2', new AbortController())
      eventManager.addConnection('user-3', new AbortController())

      expect(eventManager.getConnectionCount()).toBe(3)

      // Remove one connection
      eventManager.removeConnection('user-2')
      expect(eventManager.getConnectionCount()).toBe(2)

      // Add another connection for existing user (should replace)
      eventManager.addConnection('user-1', new AbortController())
      expect(eventManager.getConnectionCount()).toBe(2)
    })
  })
})
