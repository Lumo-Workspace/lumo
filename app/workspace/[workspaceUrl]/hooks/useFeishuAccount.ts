'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { feishuApi, type FeishuAccountStatus } from '@/lib/api-client/feishu'
import { queryKeys } from '@/lib/query/keys'
import { feishuErrorMessageId } from './feishu-callback-toast'

interface UseFeishuAccountReturn {
  status: FeishuAccountStatus | null
  loading: boolean
  disconnectOpen: boolean
  setDisconnectOpen: (open: boolean) => void
  disconnecting: boolean
  handleDisconnect: () => Promise<void>
}

/** LUM-1341 — the member's own Feishu account (Personal → Connected accounts). */
export function useFeishuAccount(): UseFeishuAccountReturn {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  const queryClient = useQueryClient()
  const queryKey = queryKeys.integrations.feishuAccount(workspaceUrl)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const query = useQuery<FeishuAccountStatus>({
    queryKey,
    queryFn: () => feishuApi.getAccountStatus(workspaceUrl),
    retry: false,
  })

  const disconnectMutation = useMutation<
    unknown,
    Error,
    void,
    { prev: FeishuAccountStatus | undefined }
  >({
    mutationFn: () => feishuApi.disconnectAccount(workspaceUrl),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey })
      const prev = queryClient.getQueryData<FeishuAccountStatus>(queryKey)
      if (prev) {
        queryClient.setQueryData<FeishuAccountStatus>(queryKey, {
          ...prev,
          connected: false,
          name: null,
          needsReauth: false,
        })
      }
      return { prev }
    },
    onSuccess: () => {
      toast.success(
        intl.formatMessage({ id: 'feishuAccount.disconnectSuccess' })
      )
    },
    onError: (_err, _vars, context) => {
      if (context?.prev !== undefined) {
        queryClient.setQueryData(queryKey, context.prev)
      }
      toast.error(intl.formatMessage({ id: 'feishuAccount.disconnectFailed' }))
    },
    onSettled: () => setDisconnectOpen(false),
  })

  // Back from the account callback with ?feishu_connected=1 / ?feishu_error=.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('feishu_error')
    if (params.get('feishu_connected') === '1') {
      toast.success(intl.formatMessage({ id: 'feishuAccount.connectSuccess' }))
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.feishuAccount(workspaceUrl),
      })
    } else if (error) {
      toast.error(intl.formatMessage({ id: feishuErrorMessageId(error) }))
    } else {
      return
    }
    window.history.replaceState({}, '', window.location.pathname)
  }, [workspaceUrl, intl, queryClient])

  return {
    status: query.data ?? null,
    loading: query.isLoading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting: disconnectMutation.isPending,
    handleDisconnect: async () => {
      await disconnectMutation.mutateAsync()
    },
  }
}
