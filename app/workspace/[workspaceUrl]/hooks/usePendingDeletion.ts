'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { workspacesClient, type PendingDeletionView } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

const STALE_TIME_MS = 60 * 1000

interface PendingDeletionState {
  pendingDeletion: PendingDeletionView | null
  isOwner: boolean
}

/**
 * LUM-918 — the workspace's pending deletion, shared by the app-shell banner
 * (every member) and the settings danger zone (owners). Mutations refresh the
 * one query so both surfaces update together.
 */
export function usePendingDeletion() {
  const queryClient = useQueryClient()
  const query = useQuery<PendingDeletionState>({
    queryKey: queryKeys.workspacePendingDeletion(),
    queryFn: async () => {
      const data = await workspacesClient.getMe<{
        pendingDeletion?: PendingDeletionView | null
        role?: string
      }>()
      return {
        pendingDeletion: data?.pendingDeletion ?? null,
        isOwner: data?.role === 'OWNER',
      }
    },
    staleTime: STALE_TIME_MS,
  })

  const refresh = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.workspacePendingDeletion(),
      }),
    [queryClient]
  )

  const schedule = useCallback(async () => {
    await workspacesClient.scheduleDeletion()
    await refresh()
  }, [refresh])

  const cancel = useCallback(async () => {
    await workspacesClient.cancelDeletion()
    await refresh()
  }, [refresh])

  return {
    pendingDeletion: query.data?.pendingDeletion ?? null,
    isOwner: query.data?.isOwner ?? false,
    schedule,
    cancel,
    deleteNow: workspacesClient.deleteNow,
  }
}
