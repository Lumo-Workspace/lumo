'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { memoriesClient, type MemoryRow } from '@/lib/api-client'
import type { MemoryCategory } from '@prisma/client'

export type MemoryScopeKind = 'project' | 'task'

interface UseMemoriesOptions {
  scope: MemoryScopeKind
  parentId: string
  enabled?: boolean
}

interface CreateInput {
  category: MemoryCategory
  content: unknown
}

/**
 * List + mutate memories for one task or one project. Mutations invalidate the
 * list query (no optimistic update — the tab is off the main path). Promote is
 * only meaningful for task scope; calling it on a project list is a no-op the
 * server rejects with 409.
 */
export function useMemories({ scope, parentId, enabled = true }: UseMemoriesOptions) {
  const queryClient = useQueryClient()
  const queryKey = ['memories', scope, parentId] as const

  const query = useQuery<{ memories: MemoryRow[] }>({
    queryKey,
    queryFn: () =>
      scope === 'project'
        ? memoriesClient.listForProject(parentId)
        : memoriesClient.listForTask(parentId),
    enabled: !!parentId && enabled,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const createMutation = useMutation({
    mutationFn: (input: CreateInput) =>
      scope === 'project'
        ? memoriesClient.createForProject(parentId, input)
        : memoriesClient.createForTask(parentId, input),
    onSuccess: invalidate,
  })

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: unknown }) =>
      memoriesClient.editContent(id, content),
    onSuccess: invalidate,
  })

  const promoteMutation = useMutation({
    mutationFn: (id: string) => memoriesClient.promoteToProject(id),
    onSuccess: () => {
      // Promote moves a row from task→project scope; refresh BOTH lists.
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['memories', 'project'] })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => memoriesClient.remove(id),
    onSuccess: invalidate,
  })

  return {
    memories: query.data?.memories ?? [],
    loading: query.isPending && !!parentId && enabled,
    error: query.error ? ((query.error as Error).message ?? 'Failed to load') : null,
    refetch: query.refetch,
    create: (input: CreateInput) => createMutation.mutateAsync(input),
    edit: (id: string, content: unknown) => editMutation.mutateAsync({ id, content }),
    promote: (id: string) => promoteMutation.mutateAsync(id),
    remove: (id: string) => removeMutation.mutateAsync(id),
    mutating:
      createMutation.isPending ||
      editMutation.isPending ||
      promoteMutation.isPending ||
      removeMutation.isPending,
  }
}
