'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  taskDecisionsClient,
  type TaskDecisionDto,
} from '@/lib/api-client/task-decisions'
import { queryKeys } from '@/lib/query/keys'

export interface DecisionInput {
  text: string
  rationale: string | null
}

/**
 * LUM-1303: a task's decisions (oldest first) plus add / edit / delete. Writes
 * wait for the server (no temp ids — LUM-658) and then refetch the list.
 */
export function useTaskDecisions(taskId: string, enabled = true) {
  const queryClient = useQueryClient()
  const queryKey = queryKeys.taskDecisions(taskId)

  const query = useQuery<TaskDecisionDto[], Error>({
    queryKey,
    queryFn: async () => (await taskDecisionsClient.list(taskId)).decisions,
    enabled,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey })

  const add = useMutation({
    mutationFn: (input: DecisionInput) =>
      taskDecisionsClient.create(taskId, input),
    onSuccess: invalidate,
  })

  const edit = useMutation({
    mutationFn: ({ id, ...input }: DecisionInput & { id: string }) =>
      taskDecisionsClient.update(taskId, id, input),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: (id: string) => taskDecisionsClient.remove(taskId, id),
    onSuccess: invalidate,
  })

  return {
    decisions: query.data ?? [],
    loading: query.isLoading,
    error: query.error?.message ?? null,
    add: add.mutateAsync,
    adding: add.isPending,
    edit: edit.mutateAsync,
    remove: remove.mutateAsync,
  }
}
