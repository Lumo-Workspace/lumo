'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  artifactsClient,
  type CreateArtifactPayload,
  type UpdateArtifactPayload,
} from '@/lib/api-client/task-artifacts'
import { queryKeys } from '@/lib/query/keys'
import type { TaskArtifact } from '@prisma/client'

// Optimistic placeholders share TaskArtifact's shape but carry a tempId +
// loading flag while the server round-trips. Server rows never have these.
export type OptimisticArtifact = TaskArtifact & {
  tempId?: string
  loading?: boolean
}

interface UseArtifactsResult {
  artifacts: OptimisticArtifact[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  add: (payload: CreateArtifactPayload) => Promise<void>
  update: (artifactId: string, payload: UpdateArtifactPayload) => Promise<void>
  remove: (artifactId: string) => Promise<void>
}

function makeOptimisticPlaceholder(
  payload: CreateArtifactPayload
): OptimisticArtifact {
  const tempId = `tmp_${Math.random().toString(36).slice(2, 10)}`
  const now = new Date()
  return {
    id: tempId,
    tempId,
    taskId: '',
    workspaceId: '',
    kind: payload.kind,
    title: payload.title,
    content: payload.content,
    source: payload.source,
    agent: payload.agent,
    order: Number.MAX_SAFE_INTEGER,
    summary: null,
    // LUM-783: the server scans content on write; a placeholder is unscanned.
    contentSignals: null,
    createdById: null,
    createdAt: now,
    updatedAt: now,
    loading: true,
  }
}

export function useArtifacts(
  taskId: string,
  enabled = true
): UseArtifactsResult {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.taskArtifacts(taskId)

  const query = useQuery<OptimisticArtifact[], Error>({
    queryKey,
    queryFn: async () => {
      const { artifacts } = await artifactsClient.list(taskId)
      return artifacts
    },
    enabled,
  })

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  const addMutation = useMutation<
    TaskArtifact,
    Error,
    CreateArtifactPayload,
    { tempId: string }
  >({
    mutationFn: async payload => {
      const { artifact } = await artifactsClient.add(taskId, payload)
      return artifact
    },
    onMutate: async payload => {
      await queryClient.cancelQueries({ queryKey })
      const placeholder = makeOptimisticPlaceholder(payload)
      queryClient.setQueryData<OptimisticArtifact[]>(queryKey, prev => [
        ...(prev ?? []),
        placeholder,
      ])
      return { tempId: placeholder.tempId! }
    },
    onSuccess: (artifact, _payload, context) => {
      queryClient.setQueryData<OptimisticArtifact[]>(queryKey, prev =>
        (prev ?? []).map(a => (a.tempId === context?.tempId ? artifact : a))
      )
    },
    onError: (_err, _payload, context) => {
      // Drop the placeholder on error — the add form surfaces the failure
      // inline, so a ghost row in the group would just confuse the user.
      queryClient.setQueryData<OptimisticArtifact[]>(queryKey, prev =>
        (prev ?? []).filter(a => a.tempId !== context?.tempId)
      )
    },
  })

  const updateMutation = useMutation<
    TaskArtifact,
    Error,
    { artifactId: string; payload: UpdateArtifactPayload },
    { previous: OptimisticArtifact[] | undefined }
  >({
    mutationFn: async ({ artifactId, payload }) => {
      const { artifact } = await artifactsClient.update(
        taskId,
        artifactId,
        payload
      )
      return artifact
    },
    onMutate: async ({ artifactId, payload }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<OptimisticArtifact[]>(queryKey)
      queryClient.setQueryData<OptimisticArtifact[]>(queryKey, prev =>
        (prev ?? []).map(a => (a.id === artifactId ? { ...a, ...payload } : a))
      )
      return { previous }
    },
    onSuccess: artifact => {
      queryClient.setQueryData<OptimisticArtifact[]>(queryKey, prev =>
        (prev ?? []).map(a => (a.id === artifact.id ? artifact : a))
      )
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
  })

  const removeMutation = useMutation<
    void,
    Error,
    string,
    { previous: OptimisticArtifact[] | undefined }
  >({
    mutationFn: artifactId => artifactsClient.remove(taskId, artifactId),
    onMutate: async artifactId => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<OptimisticArtifact[]>(queryKey)
      queryClient.setQueryData<OptimisticArtifact[]>(queryKey, prev =>
        (prev ?? []).filter(a => a.id !== artifactId)
      )
      return { previous }
    },
    onError: (_err, _artifactId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
  })

  const add = useCallback(
    async (payload: CreateArtifactPayload) => {
      await addMutation.mutateAsync(payload)
    },
    [addMutation]
  )

  const update = useCallback(
    async (artifactId: string, payload: UpdateArtifactPayload) => {
      await updateMutation.mutateAsync({ artifactId, payload })
    },
    [updateMutation]
  )

  const remove = useCallback(
    async (artifactId: string) => {
      await removeMutation.mutateAsync(artifactId)
    },
    [removeMutation]
  )

  return {
    artifacts: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    refresh,
    add,
    update,
    remove,
  }
}
