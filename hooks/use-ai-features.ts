'use client'

import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { workspacesClient } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'
import type { AiFeature, AiSwitchKey } from '@/lib/ai-features/registry'
import type { AiFeaturesStatus } from '@/lib/services/ai-features.service'

// Switches change rarely; every AI entry point reads the shared cache.
const AI_FEATURES_STALE_TIME = 5 * 60 * 1000

/**
 * LUM-1338 — the workspace's AI feature switches. `isOn(feature)` is false
 * until the state has loaded, so an entry point never shows and then
 * disappears on a deployment without a model.
 */
export function useAiFeatures() {
  const query = useQuery<AiFeaturesStatus>({
    queryKey: queryKeys.workspaceAiFeatures(),
    queryFn: () => workspacesClient.getAiFeatures(),
    staleTime: AI_FEATURES_STALE_TIME,
  })
  const effective = query.data?.effective
  const isOn = useCallback(
    (feature: AiFeature) => effective?.[feature] === true,
    [effective]
  )
  return {
    status: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
    isOn,
  }
}

/** LUM-1338 — set one switch (OWNER); the cache takes the server's answer. */
export function useSetAiFeature() {
  const queryClient = useQueryClient()
  return useMutation<
    AiFeaturesStatus,
    Error,
    { key: AiSwitchKey; enabled: boolean }
  >({
    mutationFn: ({ key, enabled }) =>
      workspacesClient.setAiFeature(key, enabled),
    onSuccess: status => {
      queryClient.setQueryData(queryKeys.workspaceAiFeatures(), status)
    },
  })
}
