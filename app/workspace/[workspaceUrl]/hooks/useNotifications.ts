'use client'

import { useCallback, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiNotification } from '../types'
import { notificationsClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

interface NotificationsData {
  notifications: ApiNotification[]
  unreadCount: number
}

export function useNotifications() {
  const queryClient = useQueryClient()
  // Memoize so the array identity is stable across renders — otherwise
  // callbacks that close over it get a new reference every render and
  // any consumer effect that depends on those callbacks loops.
  const queryKey = useMemo(() => queryKeys.notifications(), [])

  const query = useQuery<NotificationsData>({
    queryKey,
    queryFn: async () => {
      const data = await notificationsClient.list<NotificationsData>()
      return data
    },
    // Caller-driven (legacy fetchNotifications semantics).
    enabled: false,
  })

  // The TanStack `query` result object is a fresh reference every render.
  // Pin a ref so `fetchNotifications` can be a stable callback (empty deps)
  // — `useRealtimeNotifications` puts it inside a useEffect dep array, and
  // an unstable callback there causes an infinite refetch loop.
  const queryRef = useRef(query)
  queryRef.current = query

  const fetchNotifications = useCallback(async () => {
    await queryRef.current.refetch()
  }, [])

  const updateLocal = useCallback(
    (updater: (prev: NotificationsData) => NotificationsData) => {
      queryClient.setQueryData<NotificationsData>(queryKey, prev =>
        updater(prev ?? { notifications: [], unreadCount: 0 })
      )
    },
    [queryClient, queryKey]
  )

  const markOneRead = useCallback(
    async (id: string) => {
      updateLocal(prev => ({
        notifications: prev.notifications.map(n =>
          n.id === id ? { ...n, read: true } : n
        ),
        unreadCount: Math.max(0, prev.unreadCount - 1),
      }))
      try {
        await notificationsClient.markOne(id)
      } catch {
        await fetchNotifications()
      }
    },
    [updateLocal, fetchNotifications]
  )

  const markOneUnread = useCallback(
    async (id: string) => {
      updateLocal(prev => ({
        notifications: prev.notifications.map(n =>
          n.id === id ? { ...n, read: false } : n
        ),
        unreadCount: prev.unreadCount + 1,
      }))
      try {
        await notificationsClient.markOne(id, { read: false })
      } catch {
        await fetchNotifications()
      }
    },
    [updateLocal, fetchNotifications]
  )

  const deleteOne = useCallback(
    async (id: string) => {
      const snapshot = queryClient.getQueryData<NotificationsData>(queryKey)
      updateLocal(prev => {
        const wasUnread =
          prev.notifications.find(n => n.id === id)?.read === false
        return {
          notifications: prev.notifications.filter(n => n.id !== id),
          unreadCount: wasUnread
            ? Math.max(0, prev.unreadCount - 1)
            : prev.unreadCount,
        }
      })
      try {
        await notificationsClient.deleteOne(id)
      } catch {
        if (snapshot) queryClient.setQueryData(queryKey, snapshot)
      }
    },
    [queryClient, queryKey, updateLocal]
  )

  const respondToNotification = useCallback(
    async (
      id: string,
      action: 'reply' | 'confirm' | 'send_back' | 'approve' | 'deny',
      reply?: string
    ) => {
      updateLocal(prev => ({
        ...prev,
        notifications: prev.notifications.map(n =>
          n.id === id
            ? { ...n, actionTakenAt: new Date().toISOString(), read: true }
            : n
        ),
      }))
      try {
        await notificationsClient.respond(
          id,
          action === 'reply' ? { action, reply } : { action }
        )
        await fetchNotifications()
      } catch {
        await fetchNotifications()
      }
    },
    [updateLocal, fetchNotifications]
  )

  const markAllRead = useCallback(async () => {
    const snapshot = queryClient.getQueryData<NotificationsData>(queryKey)
    updateLocal(prev => ({
      notifications: prev.notifications.map(n => ({ ...n, read: true })),
      unreadCount: 0,
    }))
    try {
      await notificationsClient.markAllRead()
    } catch {
      if (snapshot) queryClient.setQueryData(queryKey, snapshot)
    }
  }, [queryClient, queryKey, updateLocal])

  return {
    notifications: query.data?.notifications ?? [],
    unreadCount: query.data?.unreadCount ?? 0,
    loading: query.isFetching && !query.data,
    error: query.error
      ? ((query.error as Error).message ?? 'Could not load notifications.')
      : null,
    fetchNotifications,
    markOneRead,
    markOneUnread,
    deleteOne,
    markAllRead,
    respondToNotification,
  }
}
