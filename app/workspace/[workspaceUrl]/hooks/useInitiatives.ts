'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { initiativesClient } from '@/lib/api-client'
import type {
  ApiInitiativeListItem,
  ApiInitiativeDetail,
  CreateInitiativeBody,
} from '@/lib/api-client/initiatives'

interface InitiativesListResult {
  initiatives: ApiInitiativeListItem[]
}

interface InitiativeDetailResult {
  initiative: ApiInitiativeDetail
}

interface CreateInitiativeResult {
  initiative: ApiInitiativeListItem
}

/** The caller team's materialised initiatives (list). */
export function useInitiatives() {
  const query = useQuery({
    queryKey: ['initiatives'],
    queryFn: () => initiativesClient.list<InitiativesListResult>(),
  })
  return {
    initiatives: query.data?.initiatives ?? [],
    isLoading: query.isLoading,
    error: query.error ? 'Failed to load initiatives' : null,
    refetch: query.refetch,
  }
}

/**
 * Create a team-level initiative. On success the
 * initiatives list query is invalidated so the new row appears.
 */
export function useCreateInitiative() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (input: CreateInitiativeBody) =>
      initiativesClient.create<CreateInitiativeResult>(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['initiatives'] })
    },
  })
  return {
    createInitiative: mutation.mutateAsync,
    isCreating: mutation.isPending,
    error: mutation.error ? 'Failed to create initiative' : null,
  }
}

/** One initiative with its attached tasks. `null` id disables the fetch. */
export function useInitiativeDetail(initiativeId: string | null) {
  const query = useQuery({
    queryKey: ['initiative', initiativeId],
    queryFn: () =>
      initiativesClient.getDetail<InitiativeDetailResult>(initiativeId!),
    enabled: !!initiativeId,
  })
  return {
    initiative: query.data?.initiative ?? null,
    isLoading: query.isLoading,
    error: query.error ? 'Failed to load initiative' : null,
    refetch: query.refetch,
  }
}
