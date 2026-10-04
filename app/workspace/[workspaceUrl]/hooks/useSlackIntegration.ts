'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { API } from '../constants'
import { apiFetch } from '@/lib/api-client'
import { queryKeys } from '@/lib/query/keys'

interface SlackStatus {
  connected: boolean
  slackTeamName?: string
  slackUserId?: string
  slackTeamId?: string
}

interface UseSlackIntegrationReturn {
  status: SlackStatus | null
  loading: boolean
  disconnectOpen: boolean
  setDisconnectOpen: (open: boolean) => void
  disconnecting: boolean
  handleConnect: () => void
  handleDisconnect: () => Promise<void>
}

export function useSlackIntegration(): UseSlackIntegrationReturn {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  const queryClient = useQueryClient()
  const queryKey = queryKeys.integrations.slack(workspaceUrl)

  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const query = useQuery<SlackStatus>({
    queryKey,
    queryFn: () => apiFetch<SlackStatus>(API.slack.integration(workspaceUrl)),
  })

  const disconnectMutation = useMutation<
    void,
    Error,
    void,
    { prev: SlackStatus | undefined }
  >({
    mutationFn: () =>
      apiFetch<void>(API.slack.integration(workspaceUrl), { method: 'DELETE' }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey })
      const prev = queryClient.getQueryData<SlackStatus>(queryKey)
      queryClient.setQueryData<SlackStatus>(queryKey, { connected: false })
      return { prev }
    },
    onSuccess: () => {
      toast.success(intl.formatMessage({ id: 'slack.disconnectSuccess' }))
    },
    onError: (_err, _vars, context) => {
      if (context?.prev !== undefined) {
        queryClient.setQueryData(queryKey, context.prev)
      }
      toast.error(intl.formatMessage({ id: 'slack.disconnectFailed' }))
    },
    onSettled: () => {
      setDisconnectOpen(false)
    },
  })

  // OAuth callback param handling — fires on mount when the OAuth round-trip
  // returned to this page with ?slack_connected=1 or ?slack_error=<reason>
  // (1 / expired / invalid_state / identity_mismatch).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('slack_connected') === '1') {
      toast.success(intl.formatMessage({ id: 'slack.connectSuccess' }))
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.slack(workspaceUrl),
      })
      window.history.replaceState({}, '', window.location.pathname)
    }
    if (params.get('slack_error')) {
      toast.error(intl.formatMessage({ id: 'slack.connectFailed' }))
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [workspaceUrl, intl, queryClient])

  const handleConnect = () => {
    window.open(API.slack.oauth(workspaceUrl), '_blank')
  }

  const handleDisconnect = async () => {
    await disconnectMutation.mutateAsync()
  }

  return {
    status: query.data ?? null,
    loading: query.isLoading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting: disconnectMutation.isPending,
    handleConnect,
    handleDisconnect,
  }
}
