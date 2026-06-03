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

// Optimistic placeholder shares MemoryRow's shape but carries a tempId +
// loading flag while the create round-trips. Server rows never have these.
export type OptimisticMemory = MemoryRow & {
  tempId?: string | undefined
  loading?: boolean | undefined
}

type ListData = { memories: OptimisticMemory[] }

function makeOptimisticPlaceholder(
  scope: MemoryScopeKind,
  parentId: string,
  input: CreateInput
): OptimisticMemory {
  const tempId = `tmp_${Math.random().toString(36).slice(2, 10)}`
  const now = new Date().toISOString()
  return {
    id: tempId,
    tempId,
    scope: scope === 'project' ? 'PROJECT' : 'TASK',
    category: input.category,
    // Best-effort guess for the brief optimistic window; the create's onSettled
    // refetch reconciles agent + createdByMemberId from the server.
    agent: 'CLAUDE_CODE',
    content: input.content,
    taskId: scope === 'task' ? parentId : null,
    createdByMemberId: null,
    createdAt: now,
    updatedAt: now,
    loading: true,
  }
}

/**
 * List + mutate memories for one task or one project, with optimistic updates.
 * create inserts a temp-ID placeholder and reconciles via refetch (the POST
 * returns only the new id); edit/remove patch the cache via setQueryData with
 * onError rollback. Promote is only meaningful for task scope; it optimistically
 * drops the row (server nulls its taskId, moving it to project scope) and
 * refetches the project list. Calling promote on a project list is a no-op the
 * server rejects with 409.
 */
export function useMemories({ scope, parentId, enabled = true }: UseMemoriesOptions) {
  const queryClient = useQueryClient()
  const queryKey = ['memories', scope, parentId] as const

  const query = useQuery<ListData>({
    queryKey,
    queryFn: () =>
      scope === 'project'
        ? memoriesClient.listForProject(parentId)
        : memoriesClient.listForTask(parentId),
    enabled: !!parentId && enabled,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const createMutation = useMutation<
    { memory: { id: string } },
    Error,
    CreateInput,
    { tempId: string }
  >({
    mutationFn: input =>
      scope === 'project'
        ? memoriesClient.createForProject(parentId, input)
        : memoriesClient.createForTask(parentId, input),
    onMutate: async input => {
      await queryClient.cancelQueries({ queryKey })
      const placeholder = makeOptimisticPlaceholder(scope, parentId, input)
      queryClient.setQueryData<ListData>(queryKey, prev => ({
        memories: [...(prev?.memories ?? []), placeholder],
      }))
      return { tempId: placeholder.tempId! }
    },
    onSuccess: (result, _input, context) => {
      // Swap the placeholder's temp id for the real one so keys are stable
      // until the onSettled refetch replaces the row with server-authored data.
      queryClient.setQueryData<ListData>(queryKey, prev => ({
        memories: (prev?.memories ?? []).map(m =>
          m.tempId === context?.tempId
            ? { ...m, id: result.memory.id, tempId: undefined, loading: undefined }
            : m
        ),
      }))
    },
    onError: (_err, _input, context) => {
      // Drop the placeholder — the add dialog surfaces the failure inline.
      queryClient.setQueryData<ListData>(queryKey, prev => ({
        memories: (prev?.memories ?? []).filter(m => m.tempId !== context?.tempId),
      }))
    },
    // The POST returns only an id, so reconcile server-authored fields (agent,
    // createdByMemberId, createdAt) with a background refetch.
    onSettled: invalidate,
  })

  const editMutation = useMutation<
    { memory: MemoryRow },
    Error,
    { id: string; content: unknown },
    { previous: ListData | undefined }
  >({
    mutationFn: ({ id, content }) => memoriesClient.editContent(id, content),
    onMutate: async ({ id, content }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ListData>(queryKey)
      queryClient.setQueryData<ListData>(queryKey, prev => ({
        memories: (prev?.memories ?? []).map(m =>
          m.id === id ? { ...m, content } : m
        ),
      }))
      return { previous }
    },
    onSuccess: ({ memory }) => {
      queryClient.setQueryData<ListData>(queryKey, prev => ({
        memories: (prev?.memories ?? []).map(m =>
          m.id === memory.id ? memory : m
        ),
      }))
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
  })

  const promoteMutation = useMutation<
    { memory: MemoryRow },
    Error,
    string,
    { previous: ListData | undefined }
  >({
    mutationFn: id => memoriesClient.promoteToProject(id),
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ListData>(queryKey)
      // Promote nulls the row's taskId server-side, so it leaves this (task)
      // list — drop it optimistically.
      queryClient.setQueryData<ListData>(queryKey, prev => ({
        memories: (prev?.memories ?? []).filter(m => m.id !== id),
      }))
      return { previous }
    },
    onSuccess: () => {
      // The promoted row now lives in the project list, which has a different
      // parentId we can't patch optimistically — refetch it.
      queryClient.invalidateQueries({ queryKey: ['memories', 'project'] })
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
  })

  const removeMutation = useMutation<
    void,
    Error,
    string,
    { previous: ListData | undefined }
  >({
    mutationFn: id => memoriesClient.remove(id),
    onMutate: async id => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<ListData>(queryKey)
      queryClient.setQueryData<ListData>(queryKey, prev => ({
        memories: (prev?.memories ?? []).filter(m => m.id !== id),
      }))
      return { previous }
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
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
