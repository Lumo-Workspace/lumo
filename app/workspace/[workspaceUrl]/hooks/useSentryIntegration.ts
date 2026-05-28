'use client'

import { useState } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { sentryApi, type SentryStatus } from '@/lib/api-client/sentry'
import { queryKeys } from '@/lib/query/keys'

interface UseSentryIntegrationReturn {
  status: SentryStatus | null
  loading: boolean
  connectOpen: boolean
  setConnectOpen: (open: boolean) => void
  mappingsOpen: boolean
  setMappingsOpen: (open: boolean) => void
  disconnectOpen: boolean
  setDisconnectOpen: (open: boolean) => void
  disconnecting: boolean
  handleDisconnect: () => Promise<void>
  refreshStatus: () => Promise<void>
}

export function useSentryIntegration(): UseSentryIntegrationReturn {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  const queryClient = useQueryClient()
  const queryKey = queryKeys.integrations.sentry(workspaceUrl)

  const [connectOpen, setConnectOpen] = useState(false)
  const [mappingsOpen, setMappingsOpen] = useState(false)
  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const query = useQuery<SentryStatus>({
    queryKey,
    queryFn: () => sentryApi.getStatus(workspaceUrl),
    retry: false,
  })

  const disconnectMutation = useMutation<unknown, Error>({
    mutationFn: () => sentryApi.disconnect(workspaceUrl),
    onSuccess: () => {
      queryClient.setQueryData<SentryStatus>(queryKey, { connected: false })
      toast.success(intl.formatMessage({ id: 'sentry.disconnectSuccess' }))
    },
    onError: () => {
      toast.error(intl.formatMessage({ id: 'sentry.disconnectFailed' }))
    },
    onSettled: () => {
      setDisconnectOpen(false)
    },
  })

  const refreshStatus = async () => {
    await queryClient.invalidateQueries({ queryKey })
  }

  const handleDisconnect = async () => {
    await disconnectMutation.mutateAsync()
  }

  return {
    status: query.data ?? null,
    loading: query.isLoading,
    connectOpen,
    setConnectOpen,
    mappingsOpen,
    setMappingsOpen,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting: disconnectMutation.isPending,
    handleDisconnect,
    refreshStatus,
  }
}
