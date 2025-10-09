/**
 * Performance test for 5-second update requirement
 * Tests that real-time updates are delivered within the required time frame
 */

import { ProfileUpdateEventManager } from '@/lib/realtime/profile-events'

// Mock the events module
jest.mock('@/lib/realtime/events', () => ({
  triggerProfileUpdate: jest.fn(),
}))

const mockTriggerProfileUpdate =
  require('@/lib/realtime/events').triggerProfileUpdate

describe('Real-time Update Performance', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('5-Second Update Requirement (SC-003)', () => {
    it('should broadcast profile updates within 5 seconds', async () => {
      const eventManager = new ProfileUpdateEventManager()
      const mockController = new AbortController()
      const userId = 'user-123'

      eventManager.addConnection(userId, mockController)

      const startTime = Date.now()

      const updateData = {
        displayName: 'Performance Test Name',
        avatarUrl: 'https://example.com/avatar.jpg',
      }

      // Act - Broadcast update
      eventManager.broadcastProfileUpdate(userId, updateData)

      const endTime = Date.now()
      const duration = endTime - startTime

      // Assert - Update should be processed within 5 seconds (5000ms)
      expect(duration).toBeLessThan(5000)
      expect(mockTriggerProfileUpdate).toHaveBeenCalledWith(userId, updateData)
    })

    it('should handle multiple concurrent updates within 5 seconds', async () => {
      const eventManager = new ProfileUpdateEventManager()
      const connections = []

      // Add 10 concurrent connections
      for (let i = 0; i < 10; i++) {
        const controller = new AbortController()
        eventManager.addConnection(`user-${i}`, controller)
        connections.push(controller)
      }

      const startTime = Date.now()

      // Broadcast updates to all connections simultaneously
      const updatePromises = connections.map((_, index) => {
        const updateData = {
          displayName: `User ${index} Updated`,
          avatarUrl: `https://example.com/avatar-${index}.jpg`,
        }
        return Promise.resolve(
          eventManager.broadcastProfileUpdate(`user-${index}`, updateData)
        )
      })

      await Promise.all(updatePromises)

      const endTime = Date.now()
      const duration = endTime - startTime

      // Assert - All updates should be processed within 5 seconds
      expect(duration).toBeLessThan(5000)
      expect(mockTriggerProfileUpdate).toHaveBeenCalledTimes(10)
    })

    it('should maintain performance with 100 concurrent connections', async () => {
      const eventManager = new ProfileUpdateEventManager()
      const connections = []

      // Add 100 concurrent connections
      for (let i = 0; i < 100; i++) {
        const controller = new AbortController()
        eventManager.addConnection(`user-${i}`, controller)
        connections.push(controller)
      }

      expect(eventManager.getConnectionCount()).toBe(100)

      const startTime = Date.now()

      // Broadcast a single update to all connections
      const updateData = {
        displayName: 'Broadcast Update',
        avatarUrl: 'https://example.com/broadcast-avatar.jpg',
      }

      // Simulate broadcasting to all connections
      for (let i = 0; i < 100; i++) {
        eventManager.broadcastProfileUpdate(`user-${i}`, updateData)
      }

      const endTime = Date.now()
      const duration = endTime - startTime

      // Assert - Should handle 100 connections within 5 seconds
      expect(duration).toBeLessThan(5000)
      expect(mockTriggerProfileUpdate).toHaveBeenCalledTimes(100)
    })
  })

  describe('Memory Usage Performance', () => {
    it('should not leak memory with connection cleanup', () => {
      const eventManager = new ProfileUpdateEventManager()

      // Add and remove connections multiple times
      for (let i = 0; i < 1000; i++) {
        const controller = new AbortController()
        eventManager.addConnection(`user-${i}`, controller)

        if (i % 10 === 0) {
          // Clean up every 10th connection
          eventManager.removeConnection(`user-${i}`)
        }
      }

      // Clean up all remaining connections
      for (let i = 0; i < 1000; i++) {
        if (i % 10 !== 0) {
          eventManager.removeConnection(`user-${i}`)
        }
      }

      expect(eventManager.getConnectionCount()).toBe(0)
    })

    it('should handle rapid connection churn efficiently', () => {
      const eventManager = new ProfileUpdateEventManager()

      const startTime = Date.now()

      // Rapidly add and remove connections
      for (let i = 0; i < 100; i++) {
        const controller = new AbortController()
        eventManager.addConnection(`user-${i}`, controller)
        eventManager.removeConnection(`user-${i}`)
      }

      const endTime = Date.now()
      const duration = endTime - startTime

      // Assert - Should handle rapid churn efficiently
      expect(duration).toBeLessThan(1000) // Within 1 second
      expect(eventManager.getConnectionCount()).toBe(0)
    })
  })

  describe('Network Performance Simulation', () => {
    it('should handle network latency gracefully', async () => {
      const eventManager = new ProfileUpdateEventManager()
      const mockController = new AbortController()
      const userId = 'user-123'

      eventManager.addConnection(userId, mockController)

      // Simulate network latency
      const originalTriggerProfileUpdate = mockTriggerProfileUpdate
      mockTriggerProfileUpdate.mockImplementation(
        async (userId: string, data: any) => {
          // Simulate 100ms network delay
          await new Promise(resolve => setTimeout(resolve, 100))
          return originalTriggerProfileUpdate(userId, data)
        }
      )

      const startTime = Date.now()

      const updateData = {
        displayName: 'Network Test Name',
      }

      await eventManager.broadcastProfileUpdate(userId, updateData)

      const endTime = Date.now()
      const duration = endTime - startTime

      // Assert - Should handle network latency and still be under 5 seconds
      expect(duration).toBeLessThan(5000)
      expect(mockTriggerProfileUpdate).toHaveBeenCalledWith(userId, updateData)
    })

    it('should handle partial network failures', async () => {
      const eventManager = new ProfileUpdateEventManager()
      const connections = []

      // Add 5 connections
      for (let i = 0; i < 5; i++) {
        const controller = new AbortController()
        eventManager.addConnection(`user-${i}`, controller)
        connections.push(controller)
      }

      // Simulate 2 connections failing
      const originalTriggerProfileUpdate = mockTriggerProfileUpdate
      let callCount = 0
      mockTriggerProfileUpdate.mockImplementation(
        async (userId: string, data: any) => {
          callCount++
          if (callCount <= 2) {
            // Simulate network failure for first 2 calls
            throw new Error('Network error')
          }
          return originalTriggerProfileUpdate(userId, data)
        }
      )

      const startTime = Date.now()

      // Broadcast to all connections
      const updateData = { displayName: 'Failure Test' }
      for (let i = 0; i < 5; i++) {
        try {
          await eventManager.broadcastProfileUpdate(`user-${i}`, updateData)
        } catch (error) {
          // Expected for some connections
        }
      }

      const endTime = Date.now()
      const duration = endTime - startTime

      // Assert - Should handle partial failures gracefully
      expect(duration).toBeLessThan(5000)
      expect(mockTriggerProfileUpdate).toHaveBeenCalledTimes(5)
    })
  })

  describe('Scalability Performance', () => {
    it('should maintain performance with increasing connection count', () => {
      const eventManager = new ProfileUpdateEventManager()
      const connectionCounts = [10, 50, 100, 500]
      const results = []

      for (const count of connectionCounts) {
        // Clear previous connections
        eventManager.cleanupAbortedConnections()

        // Add connections
        for (let i = 0; i < count; i++) {
          const controller = new AbortController()
          eventManager.addConnection(`user-${i}`, controller)
        }

        const startTime = Date.now()

        // Broadcast update
        const updateData = { displayName: `Scalability Test ${count}` }
        for (let i = 0; i < count; i++) {
          eventManager.broadcastProfileUpdate(`user-${i}`, updateData)
        }

        const endTime = Date.now()
        const duration = endTime - startTime

        results.push({ count, duration })
      }

      // Assert - Performance should not degrade significantly
      const firstResult = results[0]
      const lastResult = results[results.length - 1]

      // Performance should not degrade by more than 10x
      if (firstResult?.duration && lastResult?.duration) {
        expect(lastResult.duration).toBeLessThan(firstResult.duration * 10)
      }

      // All results should be under 5 seconds
      results.forEach(result => {
        expect(result.duration).toBeLessThan(5000)
      })
    })
  })
})
