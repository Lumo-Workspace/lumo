'use client'

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { tagsClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { ApiTag } from '../types'

/**
 * Hook to manage the workspace tag pool.
 * Fetches all tags on mount and provides create/refresh methods.
 */
export function useTags() {
  const queryClient = useQueryClient()

  const query = useQuery<ApiTag[]>({
    queryKey: queryKeys.tags(),
    queryFn: async () => {
      const data = await tagsClient.list<{ tags: ApiTag[] }>()
      return data.tags
    },
  })

  const createTag = useCallback(
    async (name: string): Promise<ApiTag | null> => {
      try {
        const data = await tagsClient.create<{ tag: ApiTag }>({ name })
        queryClient.setQueryData<ApiTag[]>(queryKeys.tags(), prev =>
          [...(prev ?? []), data.tag].sort((a, b) =>
            a.name.localeCompare(b.name)
          )
        )
        return data.tag
      } catch {
        return null
      }
    },
    [queryClient]
  )

  return {
    tags: query.data ?? [],
    loading: query.isPending,
    createTag,
    refreshTags: query.refetch,
  }
}
