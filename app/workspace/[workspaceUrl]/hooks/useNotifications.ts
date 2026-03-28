'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { ApiNotification } from '../types'
import { readCache, writeCache } from '../cache'
import { API, CACHE_KEY } from '../constants'
import { apiFetch } from '../utils'

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
      const res = await fetch(API.notifications.list)
      if (!res.ok) throw new Error('Failed to load notifications')
      const data = (await res.json()) as {
        notifications: ApiNotification[]
        unreadCount: number
      }
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
        const res = await fetch(API.notifications.markOne(id), {
          method: 'PATCH',
        })
        if (!res.ok) throw new Error()
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
        const res = await apiFetch(API.notifications.markOne(id), {
          method: 'PATCH',
          body: { read: false },
        })
        if (!res.ok) throw new Error()
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
        const res = await fetch(API.notifications.markOne(id), {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error()
      } catch {
        setNotifications(snapshot)
        setUnreadCount(snapshotCount)
      }
    },
    [notifications, unreadCount]
  )

  const markAllRead = useCallback(async () => {
    const snapshot = notifications
    const snapshotCount = unreadCount
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
    try {
      const res = await fetch(API.notifications.markAllRead, {
        method: 'PATCH',
      })
      if (!res.ok) throw new Error()
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
  }
}
