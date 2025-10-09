/**
 * Server-Sent Events infrastructure for real-time profile updates
 * Handles real-time synchronization of profile changes across team views
 */

/**
 * Event types for real-time updates
 */
export type EventType =
  | 'profile_updated'
  | 'connection_established'
  | 'connection_lost'
  | 'error'

/**
 * Base event interface
 */
export interface BaseEvent {
  type: EventType
  timestamp: Date
  userId?: string
}

/**
 * Profile update event
 */
export interface ProfileUpdateEventData extends BaseEvent {
  type: 'profile_updated'
  userId: string
  changes: {
    displayName?: string
    avatarUrl?: string | null
  }
}

/**
 * Connection event
 */
export interface ConnectionEvent extends BaseEvent {
  type: 'connection_established' | 'connection_lost'
  message?: string
}

/**
 * Error event
 */
export interface ErrorEvent extends BaseEvent {
  type: 'error'
  error: string
  code?: string | undefined
}

/**
 * Union type for all events
 */
export type RealtimeEvent =
  | ProfileUpdateEventData
  | ConnectionEvent
  | ErrorEvent

/**
 * Event emitter for real-time updates
 */
class ProfileEventEmitter {
  private connections: Map<string, Set<ReadableStreamDefaultController>> =
    new Map()
  private heartbeatInterval: NodeJS.Timeout | null = null

  constructor() {
    this.startHeartbeat()
  }

  /**
   * Add a new SSE connection
   */
  addConnection(
    userId: string,
    controller: ReadableStreamDefaultController
  ): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set())
    }

    this.connections.get(userId)!.add(controller)

    // Send connection established event
    this.sendEvent(controller, {
      type: 'connection_established',
      timestamp: new Date(),
      message: 'Real-time updates connected',
    })
  }

  /**
   * Remove an SSE connection
   */
  removeConnection(
    userId: string,
    controller: ReadableStreamDefaultController
  ): void {
    const userConnections = this.connections.get(userId)
    if (userConnections) {
      userConnections.delete(controller)

      if (userConnections.size === 0) {
        this.connections.delete(userId)
      }
    }
  }

  /**
   * Broadcast profile update to all connected users
   */
  broadcastProfileUpdate(event: ProfileUpdateEventData): void {
    // Send to all connected users (team members)
    for (const [userId, controllers] of this.connections) {
      // Don't send the update back to the user who made the change
      if (userId !== event.userId) {
        for (const controller of controllers) {
          this.sendEvent(controller, event)
        }
      }
    }
  }

  /**
   * Send event to a specific controller
   */
  private sendEvent(
    controller: ReadableStreamDefaultController,
    event: RealtimeEvent
  ): void {
    try {
      const eventData = `data: ${JSON.stringify(event)}\n\n`
      controller.enqueue(new TextEncoder().encode(eventData))
    } catch (error) {
      console.error('Failed to send SSE event:', error)
      // Remove the connection if it's no longer valid
      this.removeConnection(event.userId || 'unknown', controller)
    }
  }

  /**
   * Start heartbeat to keep connections alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const heartbeatEvent: ConnectionEvent = {
        type: 'connection_established',
        timestamp: new Date(),
        message: 'Heartbeat',
      }

      // Send heartbeat to all connections
      for (const [, controllers] of this.connections) {
        for (const controller of controllers) {
          this.sendEvent(controller, heartbeatEvent)
        }
      }
    }, 30000) // 30 seconds
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * Get connection count for monitoring
   */
  getConnectionCount(): number {
    let total = 0
    for (const controllers of this.connections.values()) {
      total += controllers.size
    }
    return total
  }

  /**
   * Get connected users
   */
  getConnectedUsers(): string[] {
    return Array.from(this.connections.keys())
  }
}

// Global event emitter instance
export const profileEventEmitter = new ProfileEventEmitter()

/**
 * Create Server-Sent Events stream for profile updates
 */
export function createProfileUpdateStream(userId: string): ReadableStream {
  return new ReadableStream({
    start(controller) {
      // Add connection to emitter
      profileEventEmitter.addConnection(userId, controller)

      // Send initial connection event
      const connectionEvent: ConnectionEvent = {
        type: 'connection_established',
        timestamp: new Date(),
        message: 'Profile updates stream connected',
      }

      const eventData = `data: ${JSON.stringify(connectionEvent)}\n\n`
      controller.enqueue(new TextEncoder().encode(eventData))
    },

    cancel() {
      // Connection closed - remove from emitter
      // Note: We can't access the controller here, so we'll handle cleanup in the API route
    },
  })
}

/**
 * Trigger profile update event
 */
export function triggerProfileUpdate(
  userId: string,
  changes: { displayName?: string; avatarUrl?: string | null }
): void {
  const event: ProfileUpdateEventData = {
    type: 'profile_updated',
    timestamp: new Date(),
    userId,
    changes,
  }

  profileEventEmitter.broadcastProfileUpdate(event)
}

/**
 * Create error event
 */
export function createErrorEvent(error: string, code?: string): ErrorEvent {
  return {
    type: 'error',
    timestamp: new Date(),
    error,
    code,
  }
}

/**
 * Validate real-time event data
 */
export function validateRealtimeEvent(event: any): event is RealtimeEvent {
  if (!event || typeof event !== 'object') {
    return false
  }

  if (!event.type || !event.timestamp) {
    return false
  }

  if (
    ![
      'profile_updated',
      'connection_established',
      'connection_lost',
      'error',
    ].includes(event.type)
  ) {
    return false
  }

  return true
}

/**
 * Format event for SSE transmission
 */
export function formatEventForSSE(event: RealtimeEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/**
 * Parse SSE event data
 */
export function parseSSEEvent(data: string): RealtimeEvent | null {
  try {
    const event = JSON.parse(data)
    return validateRealtimeEvent(event) ? event : null
  } catch {
    return null
  }
}

/**
 * Cleanup function for graceful shutdown
 */
export function cleanupRealtimeConnections(): void {
  profileEventEmitter.stopHeartbeat()
  // Additional cleanup logic can be added here
}
