'use client'

import { useQuery } from '@tanstack/react-query'
import { initiativesClient } from '@/lib/api-client'
import type {
  ApiInitiativeListItem,
  ApiInitiativeDetail,
} from '@/lib/api-client/initiatives'

interface InitiativesListResult {
  initiatives: ApiInitiativeListItem[]
}

interface InitiativeDetailResult {
  initiative: ApiInitiativeDetail
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

/** One initiative with its lineage. `null` id disables the fetch. */
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
