'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { ApiNotification } from '../types'
import { readCache, writeCache } from '../cache'
import { CACHE_KEY } from '../constants'
import { notificationsClient } from '@/lib/api-client'

export function useNotifications() {
  const [notifications, setNotifications] = useState<ApiNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef(false)
  const fetching = useRef(false)

  // Seed from cache immediately
  useEffect(() => {
    const cached = readCache<{
      notifications: ApiNotification[]
      unreadCount: number
    }>(CACHE_KEY.notifications)
    if (cached) {
      setNotifications(cached.notifications)
      setUnreadCount(cached.unreadCount)
      seeded.current = true
    }
  }, [])

  const fetchNotifications = useCallback(async () => {
    if (fetching.current) return
    fetching.current = true
    if (!seeded.current) setLoading(true)
    setError(null)
    try {
      const data = await notificationsClient.list<{
        notifications: ApiNotification[]
        unreadCount: number
      }>()
      setNotifications(data.notifications)
      setUnreadCount(data.unreadCount)
      writeCache(CACHE_KEY.notifications, data)
      seeded.current = true
    } catch {
      if (!seeded.current) setError('Could not load notifications.')
    } finally {
      setLoading(false)
      fetching.current = false
    }
  }, [])

  const markOneRead = useCallback(
    async (id: string) => {
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, read: true } : n))
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
      try {
        await notificationsClient.markOne(id)
      } catch {
        fetchNotifications()
      }
    },
    [fetchNotifications]
  )

  const markOneUnread = useCallback(
    async (id: string) => {
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, read: false } : n))
      )
      setUnreadCount(prev => prev + 1)
      try {
        await notificationsClient.markOne(id, { read: false })
      } catch {
        fetchNotifications()
      }
    },
    [fetchNotifications]
  )

  const deleteOne = useCallback(
    async (id: string) => {
      const snapshot = notifications
      const snapshotCount = unreadCount
      const wasUnread = notifications.find(n => n.id === id)?.read === false
      setNotifications(prev => prev.filter(n => n.id !== id))
      if (wasUnread) setUnreadCount(prev => Math.max(0, prev - 1))
      try {
        await notificationsClient.deleteOne(id)
      } catch {
        setNotifications(snapshot)
        setUnreadCount(snapshotCount)
      }
    },
    [notifications, unreadCount]
  )

  const respondToNotification = useCallback(
    async (
      id: string,
      action: 'reply' | 'confirm' | 'send_back' | 'approve' | 'deny',
      reply?: string
    ) => {
      // Optimistically mark action taken
      setNotifications(prev =>
        prev.map(n =>
          n.id === id
            ? { ...n, actionTakenAt: new Date().toISOString(), read: true }
            : n
        )
      )
      try {
        await notificationsClient.respond(
          id,
          action === 'reply' ? { action, reply } : { action }
        )
        // Refresh to get up-to-date server state
        await fetchNotifications()
      } catch {
        // Revert optimistic update on error
        fetchNotifications()
      }
    },
    [fetchNotifications]
  )

  const markAllRead = useCallback(async () => {
    const snapshot = notifications
    const snapshotCount = unreadCount
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
    try {
      await notificationsClient.markAllRead()
    } catch {
      setNotifications(snapshot)
      setUnreadCount(snapshotCount)
    }
  }, [notifications, unreadCount])

  return {
    notifications,
    unreadCount,
    loading,
    error,
    fetchNotifications,
    markOneRead,
    markOneUnread,
    deleteOne,
    markAllRead,
    respondToNotification,
  }
}
