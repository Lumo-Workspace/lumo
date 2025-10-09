/**
 * Profile Update Event Manager
 * Manages Server-Sent Events connections and broadcasts profile updates
 */

import { triggerProfileUpdate } from './events'

export interface ProfileUpdateData {
  displayName?: string
  avatarUrl?: string | null
}

export class ProfileUpdateEventManager {
  private connections: Map<string, AbortController> = new Map()

  /**
   * Add a new SSE connection for a user
   */
  addConnection(userId: string, controller: AbortController): void {
    // Remove existing connection for this user if it exists
    this.removeConnection(userId)

    // Add new connection
    this.connections.set(userId, controller)

    console.log(
      `Added SSE connection for user ${userId}. Total connections: ${this.connections.size}`
    )
  }

  /**
   * Remove an SSE connection for a user
   */
  removeConnection(userId: string): void {
    const controller = this.connections.get(userId)
    if (controller) {
      controller.abort()
      this.connections.delete(userId)
      console.log(
        `Removed SSE connection for user ${userId}. Total connections: ${this.connections.size}`
      )
    }
  }

  /**
   * Get the number of active connections
   */
  getConnectionCount(): number {
    return this.connections.size
  }

  /**
   * Broadcast a profile update to all connected clients
   */
  broadcastProfileUpdate(userId: string, updateData: ProfileUpdateData): void {
    try {
      // Trigger the profile update event
      triggerProfileUpdate(userId, updateData)

      console.log(
        `Broadcasted profile update for user ${userId} to ${this.connections.size} connections`
      )
    } catch (error) {
      console.error('Error broadcasting profile update:', error)
    }
  }

  /**
   * Clean up aborted connections
   */
  cleanupAbortedConnections(): void {
    const abortedConnections: string[] = []

    for (const [userId, controller] of this.connections) {
      if (controller.signal.aborted) {
        abortedConnections.push(userId)
      }
    }

    // Remove aborted connections
    abortedConnections.forEach(userId => {
      this.connections.delete(userId)
    })

    if (abortedConnections.length > 0) {
      console.log(`Cleaned up ${abortedConnections.length} aborted connections`)
    }
  }

  /**
   * Get all active user IDs with connections
   */
  getActiveUserIds(): string[] {
    return Array.from(this.connections.keys())
  }

  /**
   * Check if a user has an active connection
   */
  hasConnection(userId: string): boolean {
    const controller = this.connections.get(userId)
    return controller !== undefined && !controller.signal.aborted
  }

  /**
   * Send a custom event to a specific user
   */
  sendEventToUser(userId: string, eventType: string, data: any): void {
    const controller = this.connections.get(userId)
    if (controller && !controller.signal.aborted) {
      // This would typically send the event through the SSE connection
      // For now, we'll just log it
      console.log(`Sending ${eventType} event to user ${userId}:`, data)
    }
  }

  /**
   * Send a custom event to all connected users
   */
  broadcastEvent(eventType: string, data: any): void {
    const activeUserIds = this.getActiveUserIds()
    activeUserIds.forEach(userId => {
      this.sendEventToUser(userId, eventType, data)
    })

    console.log(
      `Broadcasted ${eventType} event to ${activeUserIds.length} users`
    )
  }
}
