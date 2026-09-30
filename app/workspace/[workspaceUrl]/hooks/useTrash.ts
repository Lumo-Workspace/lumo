'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { trashClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { TrashItemView, TrashKind } from '@/lib/services/trash.service'

/**
 * LUM-918 — the caller's trash. Restoring or purging refreshes the trash and
 * every task / document list, so a restored item reappears on the board.
 */
export function useTrash() {
  const queryClient = useQueryClient()
  const query = useQuery<TrashItemView[]>({
    queryKey: queryKeys.trash(),
    queryFn: async () => (await trashClient.list()).items,
  })

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.trash() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all() }),
      queryClient.invalidateQueries({ queryKey: ['documents'] }),
    ])
  }, [queryClient])

  const restore = useCallback(
    async (kind: TrashKind, id: string) => {
      await trashClient.restore(kind, id)
      await refresh()
    },
    [refresh]
  )

  const deletePermanently = useCallback(
    async (kind: TrashKind, id: string) => {
      await trashClient.deletePermanently(kind, id)
      await refresh()
    },
    [refresh]
  )

  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    restore,
    deletePermanently,
  }
}
