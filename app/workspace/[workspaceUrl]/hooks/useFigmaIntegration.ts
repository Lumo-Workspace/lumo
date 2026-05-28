'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { figmaApi, type FigmaIntegrationStatus } from '@/lib/api-client/figma'
import { queryKeys } from '@/lib/query/keys'

interface UseFigmaIntegrationReturn {
  status: FigmaIntegrationStatus | null
  loading: boolean
  disconnectOpen: boolean
  setDisconnectOpen: (open: boolean) => void
  disconnecting: boolean
  handleDisconnect: () => Promise<void>
}

export function useFigmaIntegration(): UseFigmaIntegrationReturn {
  const { workspaceUrl } = useParams<{ workspaceUrl: string }>()
  const intl = useIntl()
  const queryClient = useQueryClient()
  const queryKey = queryKeys.integrations.figma(workspaceUrl)

  const [disconnectOpen, setDisconnectOpen] = useState(false)

  const query = useQuery<FigmaIntegrationStatus>({
    queryKey,
    queryFn: () => figmaApi.getStatus(workspaceUrl),
    retry: false,
  })

  const disconnectMutation = useMutation<unknown, Error>({
    mutationFn: () => figmaApi.disconnect(workspaceUrl),
    onSuccess: () => {
      queryClient.setQueryData<FigmaIntegrationStatus>(queryKey, {
        connected: false,
      })
      toast.success(intl.formatMessage({ id: 'figma.disconnectSuccess' }))
    },
    onError: () => {
      toast.error(intl.formatMessage({ id: 'figma.disconnectFailed' }))
    },
    onSettled: () => {
      setDisconnectOpen(false)
    },
  })

  // OAuth callback param handling — fires once on mount when returning from
  // the Figma OAuth round-trip with ?connected=1 or ?figma_error=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected') === '1') {
      toast.success(intl.formatMessage({ id: 'figma.connectSuccess' }))
      queryClient.invalidateQueries({
        queryKey: queryKeys.integrations.figma(workspaceUrl),
      })
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('figma_error')) {
      toast.error(intl.formatMessage({ id: 'figma.connectFailed' }))
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [workspaceUrl, intl, queryClient])

  const handleDisconnect = async () => {
    await disconnectMutation.mutateAsync()
  }

  return {
    status: query.data ?? null,
    loading: query.isLoading,
    disconnectOpen,
    setDisconnectOpen,
    disconnecting: disconnectMutation.isPending,
    handleDisconnect,
  }
}
