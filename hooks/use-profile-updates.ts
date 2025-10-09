/**
 * React hook for real-time profile updates via Server-Sent Events
 * Provides profile data and connection status for real-time updates
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { UserProfile } from '@/types/profile'

export interface UseProfileUpdatesReturn {
  profile: UserProfile | null
  isConnected: boolean
  lastUpdate: Date | null
  error: string | null
  reconnect: () => void
}

export function useProfileUpdates(userId: string): UseProfileUpdatesReturn {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const connect = useCallback(() => {
    try {
      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }

      // Create new EventSource connection
      const eventSource = new EventSource('/api/profile/events')
      eventSourceRef.current = eventSource

      // Connection opened
      eventSource.onopen = () => {
        console.log('SSE connection opened')
        setIsConnected(true)
        setError(null)
      }

      // Connection closed - handle via error event when connection is lost
      // Note: EventSource doesn't have onclose, we handle disconnection via onerror

      // Handle errors
      eventSource.onerror = event => {
        console.error('SSE connection error:', event)
        setIsConnected(false)
        setError('Connection error occurred')
      }

      // Handle connection established event
      eventSource.addEventListener('connection_established', event => {
        console.log('Connection established:', event)
        setIsConnected(true)
        setError(null)
      })

      // Handle profile update events
      eventSource.addEventListener('profile_updated', event => {
        try {
          const data = JSON.parse(event.data)
          console.log('Profile update received:', data)

          if (data.userId === userId) {
            // Update profile data
            setProfile(prevProfile => ({
              ...prevProfile,
              ...data.changes,
              updatedAt: new Date(data.timestamp),
            }))

            setLastUpdate(new Date(data.timestamp))
          }
        } catch (error) {
          console.error('Error parsing profile update event:', error)
        }
      })

      // Handle heartbeat events
      eventSource.addEventListener('heartbeat', event => {
        console.log('Heartbeat received:', event)
        // Connection is alive, no action needed
      })

      // Handle error events - these are connection errors, not server errors
      eventSource.addEventListener('error', event => {
        console.error('SSE connection error event:', event)
        setError('Connection error occurred')
      })
    } catch (error) {
      console.error('Error creating SSE connection:', error)
      setError('Failed to establish connection')
      setIsConnected(false)
    }
  }, [userId])

  const reconnect = useCallback(() => {
    console.log('Manual reconnect requested')
    connect()
  }, [connect])

  // Initial connection
  useEffect(() => {
    if (userId) {
      connect()
    }

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }
  }, [userId, connect])

  // Load initial profile data
  useEffect(() => {
    if (userId) {
      const loadProfile = async () => {
        try {
          const response = await fetch('/api/profile')
          if (response.ok) {
            const profileData = await response.json()
            setProfile(profileData)
          } else {
            console.error(
              'Failed to load initial profile:',
              response.statusText
            )
          }
        } catch (error) {
          console.error('Error loading initial profile:', error)
        }
      }

      loadProfile()
    }
  }, [userId])

  return {
    profile,
    isConnected,
    lastUpdate,
    error,
    reconnect,
  }
}
