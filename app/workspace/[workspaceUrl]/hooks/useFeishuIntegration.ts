'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { feishuApi, type FeishuInstallStatus } from '@/lib/api-client/feishu'
import { queryKeys } from '@/lib/query/keys'
import { API } from '../constants'
import { feishuErrorMessageId } from './feishu-callback-toast'

interface UseFeishuIntegrationReturn {
  status: FeishuInstallStatus | null
  loading: boolean
  disconnectOpen: boolean
  setDisconnectOpen: (open: boolean) => void
  disconnecting: boolean
  handleConnect: () => void
  handleDisconnect: () => Promise<void>
}

/** LUM-1341 — the workspace's Feishu install (Workspace → Integrations). */
export function useFeishuIntegration(): UseFeishuIntegrationReturn {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  const queryClient = useQueryClient()
  const queryKey = queryKeys.integrations.feishu(workspaceUrl)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const query = useQuery<FeishuInstallStatus>({
    queryKey,
    queryFn: () => feishuApi.getInstallStatus(workspaceUrl),
    retry: false,
  })

  const disconnectMutation = useMutation<
    unknown,
    Error,
    void,
    { prev: FeishuInstallStatus | undefined }
  >({
    mutationFn: () => feishuApi.disconnectInstall(workspaceUrl),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey })
      const prev = queryClient.getQueryData<FeishuInstallStatus>(queryKey)
      queryClient.setQueryData<FeishuInstallStatus>(queryKey, {
        connected: false,
      })
      return { prev }
    },
    onSuccess: () => {
      toast.success(intl.formatMessage({ id: 'feishu.disconnectSuccess' }))
    },
    onError: (_err, _vars, context) => {
      if (context?.prev !== undefined) {
        queryClient.setQueryData(queryKey, context.prev)
      }
      toast.error(intl.formatMessage({ id: 'feishu.disconnectFailed' }))
    },
    onSettled: () => setDisconnectOpen(false),
  })

  // Back from the install callback with ?feishu_connected=1 / ?feishu_error=.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('feishu_error')
    if (params.get('feishu_connected') === '1') {
      toast.success(intl.formatMessage({ id: 'feishu.connectSuccess' }))
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.feishu(workspaceUrl),
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
    handleConnect: () => {
      window.location.href = API.feishu.install(workspaceUrl)
    },
    handleDisconnect: async () => {
      await disconnectMutation.mutateAsync()
    },
  }
}
