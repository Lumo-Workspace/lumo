'use client'

import { useParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { feishuApi, type FeishuAccountStatus } from '@/lib/api-client/feishu'
import { queryKeys } from '@/lib/query/keys'

/**
 * LUM-1343 — whether the signed-in member can import Feishu docs: their
 * account is linked under the workspace's install. Shares the account-status
 * cache with the settings card, without its callback toasts.
 */
export function useFeishuImportAvailable(): boolean {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const query = useQuery<FeishuAccountStatus>({
    queryKey: queryKeys.integrations.feishuAccount(workspaceUrl),
    queryFn: () => feishuApi.getAccountStatus(workspaceUrl),
    retry: false,
    staleTime: 60_000,
  })
  return query.data?.connected === true
}
